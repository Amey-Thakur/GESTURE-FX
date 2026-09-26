/**
 * File: scripts/app/application.ts
 * Author: Amey Thakur
 * GitHub: https://github.com/Amey-Thakur
 * Repository: https://github.com/Amey-Thakur/GESTURE-FX
 * Release Date: August 31 2026
 * License: MIT
 *
 * Tech Stack: TypeScript (ES2022), WebGL 2, MediaPipe Tasks Vision, MediaRecorder
 *
 * Description:
 * The orchestrator. It owns the state machine, the animation loop, and the
 * wiring between the camera, the tracker, the gesture engine, the renderer and
 * the recorder.
 *
 * Those five components do not reference one another. Each is constructed here
 * and each is given only what it needs on the frame it needs it, which is what
 * allows any of them to be replaced without touching the others: swapping the
 * tracker for a different model, or the recorder for an encoder, is a change
 * confined to this file and the module being replaced.
 *
 * The loop is the important part to read. It runs at the display refresh rate
 * and calls the tracker, which returns null whenever it decides to skip a frame
 * to stay inside its rate budget. Detection is therefore intermittent while
 * rendering is continuous, and effects, which play out on wall-clock time from
 * the moment the gesture happened, stay smooth regardless.
 */

import { AI, RECORDING, SETTINGS, type AspectName } from '../config';
import { Camera, CameraError } from '../camera/camera';
import { FrameRateMeter } from '../core/frame-rate';
import { formatDuration, formatFps } from '../core/format';
import { DEFAULT_FILTER, FILTERS, type FilterId } from '../effects/filters';
import { SELECTABLE_PORTAL_STYLES, type PortalStyleId } from '../effects/portal-styles';
import { EFFECTS, effectById } from '../effects/registry';
import type { EffectId } from '../effects/types';
import { EffectTimeline } from '../effects/timeline';
import { DETECTORS } from '../gestures/detectors/index';
import { GestureEngine } from '../gestures/engine';
import { RecordingCueDetector } from '../gestures/recording-cue';
import type { GestureId, GestureTrigger } from '../gestures/types';
import { probeRecording, type RecordingSupport } from '../recording/capabilities';
import { canShareVideo, downloadRecording, shareRecording } from '../recording/export';
import { Microphone } from '../recording/microphone';
import { Recorder, RecordingError, type RecordedClip } from '../recording/recorder';
import { Renderer } from '../render/renderer';
import { HandTracker } from '../tracking/tracker';
import { FaceFramer } from '../tracking/face';
import { FingerFrameTracker } from '../tracking/frame-quad';
import { QuadTrack } from '../tracking/quad-track';
import type { TrackingFrame } from '../tracking/landmarks';
import { AspectControl } from '../ui/aspect-control';
import { RadioStrip } from '../ui/radio-strip';
import { SettingsPanel } from '../ui/settings';
import { shareApplication } from '../ui/share-app';
import { Countdown } from '../ui/countdown';
import { GestureList } from '../ui/gesture-list';
import { createFrameGuide, type FrameGuide } from '../ui/frame-guide';
import { RestylePanel } from '../ui/restyle';
import { Tutorial } from '../ui/tutorial';
import { restoreKey } from '../ai/credentials';
import { OverlayController, toPresentableError } from '../ui/overlays';
import { ReviewPanel } from '../ui/review';
import { resolveShell, type Shell } from '../ui/shell';
import { Toast } from '../ui/toast';
import { TooltipController } from '../ui/tooltip';
import { Viewfinder } from '../ui/viewfinder';
import { VoiceCommands, isVoiceSupported, type VoiceCommand } from '../voice/commands';
import { LIVE_STATES, RECORDABLE_STATES, type AppState } from './state';

/** How long a hand may be absent before the tracking indicator clears. */
const TRACKING_INDICATOR_HOLD_MS = 600;

export class Application {
    private readonly shell: Shell;

    // --- Pipeline -------------------------------------------------------
    private readonly camera = new Camera();
    private readonly tracker = new HandTracker();
    private readonly engine = new GestureEngine(DETECTORS);
    private readonly timeline = new EffectTimeline();

    /**
     * The two-hand framing gesture.
     *
     * Held outside the gesture engine on purpose. The engine recognises
     * events that fire once; the finger frame is a state that persists for
     * as long as the hands hold it, and modelling it as a trigger would mean
     * inventing a release event the detector contract does not carry.
     */
    private readonly fingerFrame = new FingerFrameTracker();

    /**
     * Auto-framing.
     *
     * Separate from the hand tracker rather than folded into it, because the two
     * answer different questions at different rates and only one of them is
     * optional. The model it needs is downloaded the first time the setting is
     * on, so a user who leaves it off never pays for it.
     */
    private readonly faceFramer = new FaceFramer();

    /** Set while the face model is downloading, so it is requested once. */
    private faceModelLoading: Promise<void> | null = null;

    /**
     * Where the window was, for every instant of the take.
     *
     * Recorded on every frame while the restyle mode is armed, because the
     * geometry is only known while the hands are being tracked and the
     * composite needs it long after they have gone.
     */
    private readonly quadTrack = new QuadTrack();

    /**
     * Whether the next take is recorded clean, for a model to redraw.
     *
     * Not persisted. An armed mode that survived a reload would silently change
     * what the next recording contains, and the difference is not visible until
     * the file is played back.
     */
    private restyleArmed = false;

    /** The last clean take, held for as long as it can still be restyled. */
    private rawTake: Blob | null = null;

    private renderer: Renderer | null = null;
    private recorder: Recorder | null = null;

    // --- Interface ------------------------------------------------------
    private readonly viewfinder: Viewfinder;
    private readonly overlays: OverlayController;
    private readonly gestureList: GestureList;
    private readonly aspectControl: AspectControl;
    private readonly filterStrip: RadioStrip<FilterId>;
    private readonly styleStrip: RadioStrip<PortalStyleId>;
    private readonly settingsPanel: SettingsPanel;
    private readonly countdown: Countdown;
    private readonly review: ReviewPanel;
    private readonly toast: Toast;
    private readonly tooltips: TooltipController;
    private readonly restylePanel: RestylePanel;

    /**
     * The window outline, drawn in the document rather than by the shader.
     *
     * A clean take cannot carry the outline, and the person holding the pose
     * still has to see it. See scripts/ui/frame-guide.ts.
     */
    private readonly frameGuide: FrameGuide;
    private readonly frameRate = new FrameRateMeter();

    /**
     * Spoken commands.
     *
     * Constructed always and started only when the setting asks for it, so the
     * handlers are wired in one place rather than at every point the setting can
     * change.
     */
    private readonly voice = new VoiceCommands(
        (command) => this.onVoiceCommand(command),
        (listening) => {
            this.shell.voicePill.hidden = !listening;
        },
        (message) => {
            this.toast.show('Voice control', message);
        },
        (transcript) => {
            this.tutorial.heard(transcript);

            // Shown so that "heard the wrong words" and "heard nothing at all"
            // are distinguishable from the outside.
            this.toast.show('Heard', `“${transcript}”, which is not a command`);
        },
    );

    // --- State ----------------------------------------------------------
    private state: AppState = 'boot';
    private frameHandle = 0;
    private readonly microphone = new Microphone();

    /** Starts and stops a take from a held pose, when the setting allows it. */
    private readonly recordingCue = new RecordingCueDetector();

    /** The walkthrough, which observes the running application. */
    private tutorial!: Tutorial;

    /** Analyser and source for the walkthrough's level meter. */
    private levelContext: AudioContext | null = null;
    private levelAnalyser: AnalyserNode | null = null;
    /**
     * Typed against a concrete ArrayBuffer.
     *
     * A bare Uint8Array is ArrayBufferLike, which admits a SharedArrayBuffer and
     * which the analyser will not accept.
     */
    private levelBuffer: Uint8Array<ArrayBuffer> | null = null;

    /** Set while the walkthrough turned voice control on for its own step. */
    private voiceForTutorial = false;

    /**
     * Sound is recorded by default.
     *
     * The gesture this application is built around occupies both hands, so a
     * user who wanted sound and had to arm it first would discover the take
     * was silent only after making it. Defaulting the other way costs a user
     * who did not want sound one press, before or after the fact.
     */
    private microphoneEnabled = true;

    /**
     * Whether the user wants sound, as distinct from whether they can have it.
     *
     * `microphoneEnabled` is the achievable state and goes false when the device
     * is refused. Guarding the warning on that flag meant the one case that most
     * needed explaining, a refusal, produced no message: the flag was already
     * false, so nothing was attempted and nothing was said.
     */
    private wantsSound = true;
    private recordingSupport: RecordingSupport = { supported: false, mimeType: null };
    private clip: RecordedClip | null = null;
    private lastHandSeenAt = 0;

    /**
     * Set while a recording is being finalised.
     *
     * The duration cap is checked on every rendered frame, and stopping is
     * asynchronous, so without this the frames that elapse while the
     * recorder is stopping each call finishRecording again.
     */
    private isFinishing = false;

    /** When the last frame was drawn, watched while recording. */
    private lastRenderAt = 0;

    /** The interval that notices the canvas has stopped being painted. */
    private stallWatchdog = 0;
    private filter: FilterId = DEFAULT_FILTER;

    /** The state to return to when the settings or method panel closes. */
    private stateBeforePanel: AppState = 'ready';

    /** Restores the share control after its confirmation. */
    private shareConfirmTimer = 0;

    /**
     * Which effect each gesture fires.
     *
     * Seeded from each detector's declared default and then owned by the user,
     * who can rebind any gesture to any effect from its row. Holding the map
     * here rather than mutating the detectors keeps the registry immutable and
     * makes the independence of the two registries real rather than nominal.
     */
    private readonly effectBindings = new Map<GestureId, EffectId>();

    constructor() {
        this.shell = resolveShell();

        this.viewfinder = new Viewfinder(this.shell.viewport, this.shell.viewfinder, this.shell.canvas);
        this.overlays = new OverlayController({
            guide: this.shell.overlayGuide,
            settings: this.shell.overlaySettings,
            method: this.shell.overlayMethod,
            restyle: this.shell.overlayRestyle,
            loading: this.shell.overlayLoading,
            permission: this.shell.overlayPermission,
            error: this.shell.overlayError,
            review: this.shell.overlayReview,
        });

        this.gestureList = new GestureList(this.shell.gestureList);
        this.aspectControl = new AspectControl(this.shell.aspectGroup);
        this.filterStrip = new RadioStrip<FilterId>(this.shell.filterGroup);
        this.styleStrip = new RadioStrip<PortalStyleId>(this.shell.styleGroup);
        this.settingsPanel = new SettingsPanel(this.shell.settingsList);
        this.countdown = new Countdown(this.shell.countdown, this.shell.countdownValue);
        this.review = new ReviewPanel(
            this.shell.reviewVideo,
            this.shell.reviewDuration,
            this.shell.reviewSize,
            this.shell.reviewFormat,
        );
        this.toast = new Toast(this.shell.toast, this.shell.toastGesture, this.shell.toastEffect);
        this.tooltips = new TooltipController(this.shell.tooltip);
        this.frameGuide = createFrameGuide(this.shell.viewfinder);

        this.tutorial = new Tutorial(this.shell.tutorialOverlay, this.shell.tutorialHost, {
            onOpen: () => this.beginTutorialListening(),
            onClose: () => this.endTutorialListening(),
        });

        this.restylePanel = new RestylePanel(
            {
                keyEntry: this.shell.restyleKeyEntry,
                keyInput: this.shell.restyleKeyInput,
                keyRemember: this.shell.restyleRemember,
                keySave: this.shell.restyleSaveKey,
                keyLoaded: this.shell.restyleKeyLoaded,
                keyState: this.shell.restyleKeyState,
                keyForget: this.shell.restyleForgetKey,
                keyLink: this.shell.restyleKeyLink,
                styles: this.shell.restyleStyles,
                custom: this.shell.restyleCustom,
                model: this.shell.restyleModel,
                progress: this.shell.restyleProgress,
                fill: this.shell.restyleFill,
                status: this.shell.restyleStatus,
                error: this.shell.restyleError,
                generate: this.shell.restyleGenerate,
                cancel: this.shell.restyleCancel,
                download: this.shell.restyleDownload,
                footnote: this.shell.restyleFootnote,
            },
            () => ({
                raw: this.rawTake,
                track: this.rawTake ? this.quadTrack : null,
                mimeType: this.recordingSupport.mimeType ?? 'video/webm',
                canvas: this.shell.canvas,
                renderer: this.renderer,
            }),
        );
    }

    // =====================================================================
    // Start-up
    // =====================================================================

    /**
     * Builds the interface and enters the first state.
     *
     * The renderer is constructed before anything else that can fail, because a
     * device without WebGL 2 cannot run this application at all and should be
     * told so immediately rather than after a 20 MB download.
     */
    async start(): Promise<void> {
        this.tooltips.attach();
        this.buildInterface();
        this.bindControls();
        this.viewfinder.observe();

        try {
            this.renderer = new Renderer(this.shell.canvas);
            this.renderer.compile(EFFECTS, FILTERS);
        } catch (error) {
            this.fail(error, 'This device cannot run the effects');
            return;
        }

        this.recordingSupport = probeRecording();
        this.applyRecordingSupport();

        // Straight to the camera. The guide used to open itself on a first
        // visit, which put a four-step card between the user and the thing
        // they came to try. It is still one press away, under "How it works".
        this.setState('permission');
    }

    private buildInterface(): void {
        restoreKey();

        this.restylePanel.build({
            onComplete: (clip) => this.onRestyled(clip),
            onKeyChange: () => this.applyRestyleAvailability(),
        });

        this.settingsPanel.restore();
        this.settingsPanel.build(() => this.onSettingsChanged());

        for (const detector of DETECTORS) {
            this.effectBindings.set(detector.id, detector.effectId);
        }

        this.gestureList.build(DETECTORS, {
            onToggle: (id, enabled) => this.engine.setEnabled(id, enabled),
            onRebind: (id, effectId) => this.effectBindings.set(id, effectId),
        });

        // The recording poses sit with the gestures because that is what they
        // are. The switch here and the row in settings write the same value.
        this.gestureList.addRecordingCue(SETTINGS.recordingGestures, (enabled) => {
            SETTINGS.recordingGestures = enabled;
            this.recordingCue.reset(performance.now());

            // The panel is told rather than left to notice, so the two controls
            // never disagree, and it is the panel that owns persistence.
            this.settingsPanel.refresh();
            this.settingsPanel.save();

            this.toast.show(
                'Recording gestures',
                enabled
                    ? 'hold a ring to start a take, an open palm to stop'
                    : 'switched off; the button, voice and keyboard still work',
            );
        });

        this.aspectControl.build((aspect) => this.onAspectChange(aspect));

        this.filterStrip.build(
            FILTERS.map((entry) => ({
                value: entry.id,
                label: entry.label,
                hint: entry.description,
            })),
            this.filter,
            (filter) => {
                this.filter = filter;
            },
        );

        // The frame style is reachable from three places: this strip, the
        // settings panel and a spoken command. The strip is told when either of
        // the other two changes it, so the three cannot disagree.
        this.styleStrip.build(
            SELECTABLE_PORTAL_STYLES.map((style) => ({
                value: style.id,
                label: style.label,
                hint: style.description,
            })),
            SETTINGS.portalStyle,
            (style) => {
                SETTINGS.portalStyle = style;
                this.settingsPanel.refresh();
            },
        );

        // Sharing is offered only where the platform accepts files. Downloading
        // is always offered, because it is the route that always works.
        this.shell.shareButton.hidden = !this.canShare();

        this.applyRestyleAvailability();
    }

    /**
     * Reflects the recording probe in the interface.
     *
     * A browser that can apply effects but cannot record them is still useful,
     * so the application continues to run and only the record control is
     * disabled, carrying the reason in its tooltip.
     */
    private applyRecordingSupport(): void {
        if (this.recordingSupport.supported) {
            return;
        }

        const reason = this.recordingSupport.reason ?? 'Recording is not available in this browser.';

        this.shell.record.disabled = true;
        this.shell.record.dataset.tooltip = `${reason} Live effects still work.`;
        this.shell.microphoneButton.disabled = true;
    }

    private bindControls(): void {
        this.shell.dismissGuideButton.addEventListener('click', () => {
            this.setState('permission');
        });

        this.shell.openGuideButton.addEventListener('click', () => {
            this.setState('guide');
        });

        this.shell.openGesturesButton.addEventListener('click', () => {
            this.setGestureSheetOpen(this.shell.panel.dataset.open !== 'true');
        });

        this.shell.closeGesturesButton.addEventListener('click', () => {
            this.setGestureSheetOpen(false);
        });

        this.shell.panelBackdrop.addEventListener('click', () => {
            this.setGestureSheetOpen(false);
        });

        for (const button of this.shell.openMethodButtons) {
            button.addEventListener('click', () => {
                this.stateBeforePanel = this.isPanel(this.state) ? this.stateBeforePanel : this.state;
                this.setState('method');
            });
        }

        this.shell.closeMethodButton.addEventListener('click', () => {
            this.closePanel();
        });

        this.shell.openSettingsButton.addEventListener('click', () => {
            this.stateBeforePanel = this.isPanel(this.state) ? this.stateBeforePanel : this.state;
            this.setState('settings');
        });

        this.shell.closeSettingsButton.addEventListener('click', () => {
            this.closePanel();
        });

        this.shell.shareAppButton.addEventListener('click', () => {
            void this.shareApplication();
        });

        this.shell.requestCameraButton.addEventListener('click', () => {
            void this.beginSession();
        });

        this.shell.retryButton.addEventListener('click', () => {
            this.setState('permission');
        });

        this.shell.record.addEventListener('click', () => {
            void this.onRecordPressed();
        });

        this.shell.toggleRestyleButton.addEventListener('click', () => {
            // Without a key there is nothing to arm for, so the control opens
            // the panel that asks for one instead of refusing silently.
            if (!this.restylePanel.hasKey) {
                this.openRestylePanel();
                return;
            }

            this.setRestyleArmed(!this.restyleArmed);
        });

        this.shell.openRestyleButton.addEventListener('click', () => {
            this.openRestylePanel();
        });

        this.shell.closeRestyleButton.addEventListener('click', () => {
            this.closePanel();
        });

        this.shell.microphoneButton.addEventListener('click', () => {
            void this.toggleMicrophone();
        });

        document.querySelector('[data-action="open-tutorial"]')
            ?.addEventListener('click', () => {
                this.closePanel();
                this.tutorial.start();
            });

        document.querySelector('[data-action="tutorial-skip"]')
            ?.addEventListener('click', () => this.tutorial.skip());

        document.querySelector('[data-action="tutorial-close"]')
            ?.addEventListener('click', () => this.tutorial.close());

        this.shell.switchCameraButton.addEventListener('click', () => {
            void this.switchCamera();
        });

        this.shell.downloadButton.addEventListener('click', () => {
            this.downloadRecording();
        });

        this.shell.shareButton.addEventListener('click', () => {
            void this.shareRecording();
        });

        this.shell.recordAgainButton.addEventListener('click', () => {
            this.review.release();
            this.clip = null;
            this.setState('ready');
        });

        // A recording continues encoding while the tab is hidden, but the
        // canvas stops being painted, so the file would fill with a frozen
        // frame. Ending the take is the honest outcome.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'recording') {
                void this.finishRecording();
            }
        });

        // The guide is dismissible with the keyboard, like any dialog.
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') {
                return;
            }

            if (this.shell.panel.dataset.open === 'true') {
                this.setGestureSheetOpen(false);
                return;
            }

            if (this.isPanel(this.state)) {
                this.closePanel();
                return;
            }

            if (this.state === 'guide') {
                this.setState('permission');
            }
        });
    }

    // =====================================================================
    // State
    // =====================================================================

    private setState(next: AppState): void {
        this.state = next;

        switch (next) {
            case 'guide':
                this.overlays.show('guide');
                break;

            case 'settings':
                this.overlays.show('settings');
                break;

            case 'method':
                this.overlays.show('method');
                break;

            case 'restyle':
                this.overlays.show('restyle');
                break;

            case 'permission':
                this.overlays.show('permission');
                break;

            case 'loading':
                this.overlays.show('loading');
                break;

            case 'review':
                this.overlays.show('review');
                break;

            case 'ready':
            case 'countdown':
            case 'recording':
                this.overlays.hide();
                break;

            case 'error':
                // The overlay is shown by `fail`, which has the error to render.
                break;

            default:
                break;
        }

        // The record control is usable only when a take can start or stop, and
        // never in a browser that cannot write a video at all.
        const canRecord = this.recordingSupport.supported && RECORDABLE_STATES.has(next);
        this.shell.record.disabled = !canRecord;

        this.shell.viewfinder.dataset.recording = String(this.state === 'recording');
        this.shell.recordingPill.hidden = this.state !== 'recording';
        this.aspectControl.setDisabled(this.state === 'recording' || this.state === 'countdown');

        if (LIVE_STATES.has(next)) {
            this.startLoop();
        } else {
            this.stopLoop();
        }
    }

    /** Requests the camera, loads the tracker, and goes live. */
    /**
     * Opens or closes the gesture sheet.
     *
     * Below the desktop breakpoint the gesture panel is a sheet rather than a
     * fixed column, because five rows of two controls each will not fit beside
     * a viewfinder on a phone without either shrinking the frame or hiding
     * items behind a horizontal scroll. On a desktop the control that calls
     * this is not rendered, and the panel is always visible.
     */
    private setGestureSheetOpen(open: boolean): void {
        this.shell.panel.dataset.open = String(open);
        this.shell.panelBackdrop.hidden = !open;
        this.shell.openGesturesButton.setAttribute('aria-expanded', String(open));

        if (open) {
            // Focus the first row, so the sheet is usable from a keyboard and
            // announced on opening.
            this.shell.panel.querySelector<HTMLElement>('.chip__toggle')?.focus();
        } else {
            this.shell.openGesturesButton.focus();
        }
    }

    /** Whether a state is one of the two panels that open over another. */
    private isPanel(state: AppState): boolean {
        return state === 'settings' || state === 'method' || state === 'restyle';
    }

    /**
     * Opens the restyle panel over whatever is showing.
     *
     * Reachable from the review, where a finished take is waiting, and from the
     * arm control, where the user has asked for a mode that needs a key first.
     */
    private openRestylePanel(): void {
        this.stateBeforePanel = this.isPanel(this.state) ? this.stateBeforePanel : this.state;
        this.restylePanel.refresh();
        this.setState('restyle');
    }

    /**
     * Arms or disarms recording a clean take.
     *
     * Armed, the canvas carries the camera image and nothing else: no window,
     * no outline, no corner marks. That is what a video model needs to redraw,
     * and anything drawn into the canvas would be redrawn along with it. The
     * outline moves to a guide over the frame, which the recorder does not see.
     */
    private setRestyleArmed(armed: boolean): void {
        this.restyleArmed = armed;

        this.shell.toggleRestyleButton.setAttribute('aria-pressed', String(armed));
        this.shell.toggleRestyleButton.dataset.tooltip = armed
            ? 'Recording raw, for a Gemini restyle. The window is a guide only.'
            : 'Record raw for a Gemini restyle';

        this.shell.aiPill.hidden = !armed;

        if (!armed) {
            this.frameGuide.hide();
        }

        const { width, height } = this.viewfinder.outputSize;
        this.frameGuide.setOutputSize(width, height);
    }

    /**
     * Reflects whether a restyle is possible at all.
     *
     * The arm control stays usable without a key, because pressing it is how a
     * user discovers where a key goes. Only the offer in the review panel is
     * withheld, and only when there is nothing to restyle.
     */
    private applyRestyleAvailability(): void {
        this.shell.openRestyleButton.hidden = this.rawTake === null;

        if (!this.restylePanel.hasKey && this.restyleArmed) {
            this.setRestyleArmed(false);
        }
    }

    /**
     * Replaces the reviewed take with the composited one.
     *
     * The raw take is released at the same time. It exists only to be sent for
     * restyling, and keeping a second copy of a recording in memory after that
     * is done is how a phone runs out of it.
     */
    private onRestyled(clip: RecordedClip): void {
        this.clip = clip;
        this.rawTake = null;

        this.review.present(clip);
        this.applyRestyleAvailability();
        this.setState('review');

        this.toast.show('Restyled', 'the generated take is in the review panel');
    }

    /**
     * Returns to whatever was showing before a panel opened.
     *
     * Every panel is reachable from the masthead, which is reachable before the
     * camera has been allowed, so the cards that come before it are resumable
     * too. The permission card is the only way to start the camera and the
     * error card is the only account of why it did not start: falling through
     * to the camera from either one left the user on an empty stage with
     * nothing to press and no way back short of reloading.
     *
     * What is not resumable is anything the application moves on from by
     * itself. Loading ends when the model arrives and a take ends when it is
     * stopped, so returning to either would restore a card that has already
     * been overtaken.
     */
    private closePanel(): void {
        const resumable: AppState[] = ['ready', 'review', 'guide', 'permission', 'error'];

        this.setState(
            resumable.includes(this.stateBeforePanel) ? this.stateBeforePanel : 'ready',
        );
    }

    /**
     * Applies a settings change that the rest of the application cannot pick up
     * on its own.
     *
     * Sensitivity and the countdown are read where they are used, so they need
     * nothing here. Mirroring changes what the renderer draws and is picked up
     * on the next frame. Only the detector state has to be discarded, because a
     * gesture half recognised under the previous sensitivity would otherwise
     * complete under the new one.
     */
    private onSettingsChanged(): void {
        this.engine.reset();
        this.styleStrip.select(SETTINGS.portalStyle);
        this.gestureList.setRecordingCueEnabled(SETTINGS.recordingGestures);
        this.recordingCue.reset(performance.now());

        void this.applyAutoFrame();
        this.applyVoiceControl();
    }

    /**
     * Shares a link to the application, and confirms it on the button itself.
     *
     * The confirmation is not a toast. The toast lives inside the viewfinder,
     * and this control is reachable while an overlay covers the viewfinder, so
     * a toast would confirm a copy the user could not see. A control that
     * reports its own result is visible in every state.
     */
    private async shareApplication(): Promise<void> {
        const outcome = await shareApplication();

        if (outcome === 'dismissed') {
            return;
        }

        const button = this.shell.shareAppButton;
        const original = button.innerHTML;
        const label = outcome === 'copied' ? 'Link copied' : 'Shared';

        button.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="m5 12.5 4.5 4.5L19 7.5" /></svg>';

        button.dataset.tooltip = label;
        button.setAttribute('aria-label', label);

        window.clearTimeout(this.shareConfirmTimer);
        this.shareConfirmTimer = window.setTimeout(() => {
            button.innerHTML = original;
            button.dataset.tooltip = 'Share GESTURE-FX';
            button.setAttribute('aria-label', 'Share GESTURE-FX');
        }, 1800);
    }

    /**
     * Turns recorded sound on or off, acquiring the device on the first press
     * if it was refused or dismissed when the session began.
     */
    private async toggleMicrophone(): Promise<void> {
        const turningOn = !this.microphoneEnabled;

        if (turningOn && !this.microphone.isAvailable) {
            this.shell.microphoneButton.disabled = true;
            const state = await this.microphone.prime();
            this.shell.microphoneButton.disabled = false;

            if (state !== 'granted') {
                this.microphoneEnabled = false;
                this.reflectMicrophoneState();
                this.toast.show(
                    'Microphone',
                    'Permission was not granted, so takes will have no sound. Allow the microphone in your browser to turn it on.',
                );

                return;
            }
        }

        this.microphoneEnabled = turningOn;
        this.wantsSound = turningOn;
        this.reflectMicrophoneState();
    }

    /** Puts the microphone button in step with the device and the setting. */
    private reflectMicrophoneState(): void {
        const on = this.microphoneEnabled && this.microphone.isAvailable;

        this.microphoneEnabled = on;

        this.shell.microphoneButton.setAttribute('aria-pressed', String(on));

        const label = on
            ? 'Sound is being recorded'
            : this.microphone.permission === 'denied'
                ? 'No microphone permission. Press to ask again'
                : 'Record sound';

        this.shell.microphoneButton.dataset.tooltip = label;
        this.shell.microphoneButton.setAttribute('aria-label', label);
    }

    private async beginSession(): Promise<void> {
        try {
            this.shell.requestCameraButton.disabled = true;
            await this.camera.start();
        } catch (error) {
            this.shell.requestCameraButton.disabled = false;
            this.fail(error, error instanceof CameraError && error.kind === 'permission-denied'
                ? 'Camera permission is needed'
                : 'The camera could not be started');
            return;
        }

        this.shell.requestCameraButton.disabled = false;
        this.shell.switchCameraButton.hidden = !(await this.camera.hasMultipleCameras());

        // Asked for immediately after the camera, so the browser groups both
        // into one permission sheet. The device is closed again straight away:
        // speech recognition wants the same microphone, and holding it for the
        // whole session takes it from the recogniser. A refusal is recorded and
        // does not stop the session.
        const microphone = await this.microphone.prime();
        this.reflectMicrophoneState();

        if (this.wantsSound && microphone !== 'granted') {
            this.toast.show(
                'No microphone',
                microphone === 'denied'
                    ? 'permission was refused, so recordings will be silent until it is allowed'
                    : 'this browser offers none, so recordings will be silent',
            );
        }

        this.setState('loading');

        try {
            await this.tracker.load((progress) => {
                this.overlays.setLoading(progress.stage, progress.ratio, {
                    fill: this.shell.loadingFill,
                    stage: this.shell.loadingStage,
                    percent: this.shell.loadingPercent,
                });
            });
        } catch (error) {
            this.fail(error, 'Hand tracking could not start');
            return;
        }

        this.setState('ready');

        // Both of these are conveniences, so neither is allowed to delay going
        // live and neither is allowed to fail the session.
        void this.applyAutoFrame();
        this.applyVoiceControl();

        // The walkthrough no longer opens itself. It was the second thing to
        // dismiss on a first visit, and it is worth the most when something is
        // not working rather than before anything has been tried, so it lives
        // in Settings under "Try the controls".
    }

    /**
     * Loads the face model when auto-framing is on, and forgets it when it is
     * off.
     *
     * The model is fetched on demand rather than at start-up, so it is not on
     * the path between pressing the button and seeing the camera. Until it
     * arrives the crop stays centred, which is exactly what it does when the
     * setting is off, so there is no state in between to handle.
     */
    private async applyAutoFrame(): Promise<void> {
        if (!SETTINGS.autoFrame) {
            this.faceFramer.reset();
            return;
        }

        const fileset = this.tracker.fileset;

        if (!fileset || this.faceFramer.isReady || this.faceModelLoading) {
            return;
        }

        this.faceModelLoading = this.faceFramer.load(fileset);

        try {
            await this.faceModelLoading;
        } catch {
            // Auto-framing is unavailable on this device. A centred crop is a
            // complete application, so the session continues without a word.
            SETTINGS.autoFrame = false;
        } finally {
            this.faceModelLoading = null;
        }
    }

    /** Starts or stops listening to match the setting. */
    private applyVoiceControl(): void {
        if (SETTINGS.voiceControl && isVoiceSupported()) {
            this.voice.start();
        } else {
            this.voice.stop();
        }
    }

    /**
     * Acts on a spoken command.
     *
     * Recording is guarded by the same state check the button uses, so saying
     * "record" while a take is already running does nothing rather than
     * restarting it. The style commands are accepted at any time, because
     * changing what the window shows mid-take is a legitimate thing to do and
     * is one of the reasons to have voice control at all.
     */
    /**
     * Starts a take in response to a spoken command.
     *
     * The word is said from whichever state the user happens to be in, which
     * after the first take is `review` and not `ready`. Acting only on `ready`
     * meant every "record" after the first was discarded without a sound, which
     * is indistinguishable from the recogniser not working at all. Anything
     * showing over the preview is dismissed first, and a command that genuinely
     * cannot be acted on says why.
     */
    /**
     * Acts on a held pose, when the setting allows it.
     *
     * Read on every tracked frame and deliberately not routed through the
     * gesture engine: that engine maps gestures onto effects, and these two
     * poses are not effects. Keeping them apart means a user cannot bind the
     * pose that stops a take to something else and lose the ability to stop.
     */
    /**
     * Drives the walkthrough from the frame loop.
     *
     * The camera and hand steps are satisfied here because neither is an event;
     * they are conditions, and the loop is where conditions are observed. The
     * pose steps are satisfied by the cue detector, which runs during the
     * walkthrough regardless of the setting, because the point is to find out
     * whether the poses work before deciding to switch them on.
     */
    private readTutorial(tracking: TrackingFrame | null, now: number): void {
        if (!this.tutorial.isOpen) {
            return;
        }

        this.shell.tutorialWatch.hidden = this.tutorial.current === null;

        if (this.tutorial.current === null) {
            return;
        }

        // What the tracker can see, reported every frame. A step that is not
        // passing is nearly always a hand the camera cannot see, and saying so
        // is more useful than repeating the instruction.
        const hands = tracking?.hands.length ?? 0;
        const seen = hands > 0;

        this.shell.tutorialWatch.dataset.seen = String(seen);
        this.shell.tutorialWatchText.textContent = seen
            ? `${hands === 1 ? 'One hand' : `${hands} hands`} in view`
            : 'No hand in view';

        const step = this.tutorial.current;

        if (step === 'camera') {
            this.tutorial.cameraReady();
            return;
        }

        if (step === 'hand' && tracking && tracking.hands.length > 0) {
            this.tutorial.observe('hand');
            return;
        }

        if (step === 'ring' || step === 'palm') {
            const cue = this.recordingCue.update(tracking, now, step === 'palm');

            if (cue) {
                this.gestureList.flashRecordingCue();
                this.tutorial.observe(step);
            }

            return;
        }

        if (step === 'microphone') {
            this.tutorial.setLevel(this.microphoneLevel(), now);
        }
    }

    /**
     * The current microphone level, from the samples rather than the permission.
     *
     * A granted permission and a working microphone are different things, and
     * the whole reason this step exists is that the difference is invisible
     * everywhere else in the interface.
     */
    private microphoneLevel(): number {
        if (!this.levelAnalyser || !this.levelBuffer) {
            return 0;
        }

        this.levelAnalyser.getByteTimeDomainData(this.levelBuffer);

        let peak = 0;

        for (const sample of this.levelBuffer) {
            peak = Math.max(peak, Math.abs(sample - 128) / 128);
        }

        return peak;
    }

    /** Opens the microphone and the recogniser for the duration of the walkthrough. */
    private async beginTutorialListening(): Promise<void> {
        const state = await this.microphone.open();

        if (state === 'granted') {
            try {
                const context = new AudioContext();
                const analyser = context.createAnalyser();

                analyser.fftSize = 1024;

                context.createMediaStreamSource(new MediaStream(this.microphone.tracks()))
                    .connect(analyser);

                this.levelContext = context;
                this.levelAnalyser = analyser;
                // Backed by an explicit ArrayBuffer: the default is typed as
                // ArrayBufferLike, which the analyser will not accept.
                this.levelBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
            } catch (error) {
                console.warn('[gesture-fx] level meter unavailable', error);
            }
        }

        // Voice is switched on for the walkthrough even when the setting is off,
        // because the step exists to find out whether it works at all.
        if (!SETTINGS.voiceControl && isVoiceSupported()) {
            this.voiceForTutorial = true;
            this.voice.start();
        }
    }

    /** Puts the microphone and the recogniser back the way they were. */
    private endTutorialListening(): void {
        this.levelContext?.close().catch(() => {
            // Closing a context that is already closed is not an error worth
            // reporting to anyone.
        });

        this.levelContext = null;
        this.levelAnalyser = null;
        this.levelBuffer = null;

        if (this.voiceForTutorial) {
            this.voiceForTutorial = false;
            this.voice.stop();
        }

        if (this.state !== 'recording') {
            this.microphone.close();
        }

        this.recordingCue.reset(performance.now());
    }

    private readRecordingCue(tracking: TrackingFrame | null, now: number): void {
        if (!SETTINGS.recordingGestures || !this.recordingSupport.supported) {
            return;
        }

        const recording = this.state === 'recording';

        // Only these two states are meaningful. A pose struck while a panel is
        // open or a take is being reviewed is not an instruction.
        if (!recording && this.state !== 'ready') {
            return;
        }

        const cue = this.recordingCue.update(tracking, now, recording);

        if (!cue) {
            return;
        }

        this.gestureList.flashRecordingCue();

        this.toast.show(
            cue === 'start' ? 'Ring held' : 'Palm held',
            cue === 'start' ? 'starting the recording' : 'stopping the recording',
        );

        void this.onRecordPressed();
    }

    private async startTakeByVoice(): Promise<void> {
        if (!this.recordingSupport.supported) {
            this.toast.show('Heard', 'this browser cannot record, so there is nothing to start');
            return;
        }

        if (this.state === 'recording' || this.state === 'countdown') {
            return;
        }

        // A finished take is put away, exactly as the button does it.
        if (this.state === 'review') {
            this.review.release();
            this.clip = null;
            this.setState('ready');
        }

        // A panel over the preview is closed, so the take is not made behind it.
        if (this.state === 'settings' || this.state === 'method' || this.state === 'restyle') {
            this.closePanel();
        }

        if (this.state !== 'ready') {
            this.toast.show('Heard', 'the camera is not live yet, so a take cannot start');
            return;
        }

        this.toast.show('Heard', 'starting the recording');
        await this.onRecordPressed();
    }

    private onVoiceCommand(command: VoiceCommand): void {
        // A recognised command is the strongest possible pass for that step, and
        // it is swallowed here rather than acted on: the walkthrough should not
        // start a take because the user was asked to say the word.
        if (this.tutorial.isOpen) {
            this.tutorial.heard(command.kind === 'style' ? command.style : command.kind);
            return;
        }

        if (command.kind === 'style') {
            SETTINGS.portalStyle = command.style;
            this.settingsPanel.refresh();
            this.styleStrip.select(command.style);
            this.toast.show('Heard', `frame style set to ${command.style === 'anime' ? 'cartoon' : command.style}`);
            return;
        }

        if (command.kind === 'record') {
            void this.startTakeByVoice();
            return;
        }

        // A countdown is stopped rather than recorded through. Saying stop
        // during it means the same thing it means a second later.
        if (this.state === 'countdown') {
            this.countdown.hide();
            this.toast.show('Heard', 'the countdown was stopped');
            this.setState('ready');
            return;
        }

        if (this.state === 'recording') {
            this.toast.show('Heard', 'stopping the recording');
            void this.onRecordPressed();
        }
    }

    private async switchCamera(): Promise<void> {
        try {
            await this.camera.switchFacing();
            this.engine.reset();
            this.faceFramer.reset();
        } catch (error) {
            this.fail(error, 'The camera could not be switched');
        }
    }

    private onAspectChange(aspect: AspectName): void {
        this.viewfinder.setAspect(aspect);
    }

    // =====================================================================
    // Animation loop
    // =====================================================================

    private startLoop(): void {
        if (this.frameHandle !== 0) {
            return;
        }

        this.frameHandle = requestAnimationFrame(this.frame);
    }

    private stopLoop(): void {
        if (this.frameHandle !== 0) {
            cancelAnimationFrame(this.frameHandle);
            this.frameHandle = 0;
        }

        this.frameRate.reset();
    }

    /**
     * One frame.
     *
     * The order is deliberate. Tracking runs first so a gesture recognised this
     * frame can start its effect before anything is drawn; the timeline is then
     * advanced so a finished effect is retired; and only then is the frame
     * rendered, so the canvas that gets captured is always current.
     */
    private readonly frame = (now: number): void => {
        this.frameHandle = requestAnimationFrame(this.frame);

        const { video } = this.camera;

        // The tracker returns null when it skips a frame to stay inside its
        // rate budget, which is not the same as finding no hands.
        const tracking = this.tracker.detect(video, now);

        this.readTutorial(tracking, now);
        this.readRecordingCue(tracking, now);

        for (const trigger of this.engine.update(tracking, now)) {
            this.onGesture(trigger, now);
        }

        this.fingerFrame.update(tracking, now);

        // Auto-framing runs on its own rate budget and returns nothing until it
        // has seen a face, so this is a no-op until it is both enabled and ready.
        if (SETTINGS.autoFrame) {
            this.faceFramer.update(video, now);
        }

        this.timeline.update(now);
        const mirrored = this.camera.isMirrored && SETTINGS.mirrorPreview;
        const quad = this.fingerFrame.current;

        // Armed, the window is withheld from the canvas so the recording stays
        // a clean camera image, and drawn over it instead.
        this.renderer?.render(
            video,
            this.timeline,
            now,
            mirrored,
            this.filter,
            this.restyleArmed ? null : quad,
            SETTINGS.portalStyle,
            SETTINGS.autoFrame ? this.faceFramer.framing(now) : null,
        );

        if (this.restyleArmed) {
            this.frameGuide.update(
                quad && this.renderer ? this.renderer.projectQuad(quad) : null,
                quad?.presence ?? 0,
            );

            if (this.state === 'recording') {
                this.quadTrack.capture(quad, now);
            }
        }

        // Recorded by the watchdog below, which is the only way to notice
        // that this loop has stopped running.
        this.lastRenderAt = now;

        this.updateIndicators(tracking, now);
    };

    /** Starts the effect a gesture asked for, and reports it in the interface. */
    private onGesture(trigger: GestureTrigger, now: number): void {
        this.tutorial.observe(trigger.gestureId);

        const detector = DETECTORS.find((candidate) => candidate.id === trigger.gestureId);

        // The user's binding takes precedence over the detector's default.
        const effectId = this.effectBindings.get(trigger.gestureId) ?? trigger.effectId;
        const effect = effectById(effectId);

        this.timeline.trigger({ ...trigger, effectId }, now);
        this.gestureList.flash(trigger.gestureId);

        if (detector) {
            this.toast.show(detector.label, `fired ${effect.label.toLowerCase()}`);
        }
    }

    /** Refreshes the tracking pill, the timer and the frame rate readout. */
    private updateIndicators(tracking: TrackingFrame | null, now: number): void {
        if (tracking && tracking.hands.length > 0) {
            this.lastHandSeenAt = now;
        }

        const handVisible = now - this.lastHandSeenAt < TRACKING_INDICATOR_HOLD_MS;

        this.shell.trackingPill.hidden = !handVisible;

        // The window is a state, so it is reported as one rather than as a
        // toast that has already gone by the time the user looks up.
        this.shell.framePill.hidden = this.fingerFrame.current === null;

        if (handVisible && tracking) {
            this.shell.trackingLabel.textContent =
                tracking.hands.length > 1 ? 'Two hands' : 'Hand detected';
        }

        this.shell.fps.textContent = formatFps(this.frameRate.sample(now));

        if (this.state === 'recording' && this.recorder) {
            const elapsed = this.recorder.elapsed(now);
            this.shell.timer.textContent = formatDuration(elapsed);

            // A recording is bounded so a long take cannot exhaust memory on a
            // phone, which fails as a lost recording rather than a warning.
            // A take bound for a model is capped far shorter: the API accepts
            // it inline only up to a size, and every second of it is billed.
            const limit = this.restyleArmed ? AI.maximumClipMs : RECORDING.maximumDurationMs;

            if (elapsed >= limit) {
                void this.finishRecording();
            }
        }
    }

    // =====================================================================
    // Recording
    // =====================================================================

    private async onRecordPressed(): Promise<void> {
        if (this.state === 'recording') {
            await this.finishRecording();
            return;
        }

        if (this.state === 'ready') {
            await this.beginRecording();
        }
    }

    private async beginRecording(): Promise<void> {
        const { mimeType } = this.recordingSupport;

        if (!mimeType) {
            return;
        }

        this.setState('countdown');
        this.shell.record.disabled = true;

        if (SETTINGS.countdownSeconds > 0) {
            await this.countdown.run(SETTINGS.countdownSeconds);

            // The user may have hit an error or navigated during the countdown.
            if (this.state !== 'countdown') {
                return;
            }
        }

        // Each take starts from a clean slate, so a gesture half-completed
        // before recording cannot fire into the opening frame.
        this.setGestureSheetOpen(false);

        this.engine.reset();
        this.recordingCue.reset(performance.now());
        this.fingerFrame.reset();
        this.timeline.clear();
        this.gestureList.clearHighlights();

        // The rewind buffer is cleared so a cut cannot reach into the previous
        // take, which would put footage in the file that the user did not
        // record as part of it.
        this.renderer?.clearHistory();

        this.recorder = new Recorder(mimeType);

        // A new take invalidates the last one's geometry, and the raw clip it
        // belonged to, whether or not this take is armed.
        this.quadTrack.begin(performance.now());
        this.rawTake = null;
        this.applyRestyleAvailability();

        try {
            // Opened here rather than held open, so that between takes the
            // recogniser has the device. Permission is already granted by this
            // point, so this does not prompt.
            // Attempted whenever sound is wanted, not only when it is
            // currently achievable. A refusal at session start leaves the
            // achievable flag false, and a warning guarded by that flag is a
            // warning that never fires in the case that needs it.
            if (this.wantsSound) {
                const state = await this.microphone.open();

                this.microphoneEnabled = state === 'granted';
                this.reflectMicrophoneState();

                // Said before the take rather than discovered after it. A
                // silent recording is not recoverable, and the user is the only
                // one who can do anything about a refused microphone.
                if (state !== 'granted') {
                    this.toast.show(
                        'No microphone',
                        state === 'denied'
                            ? 'permission was refused, so this take will have no sound'
                            : 'this browser offers no microphone, so this take will have no sound',
                    );
                }
            }

            await this.recorder.start(this.shell.canvas, {
                audioTracks: this.microphoneEnabled ? this.microphone.tracks() : [],
            });
        } catch (error) {
            this.recorder = null;
            this.fail(error, 'Recording could not start');
            return;
        }

        // The recorder reports what it actually attached, which is the only
        // statement about sound that is worth making: a track can be requested,
        // granted, and still not reach the encoder.
        if (this.microphoneEnabled && !this.recorder.hasAudio) {
            this.toast.show('No sound', 'the microphone did not reach the recorder, so this take is silent');
        }

        this.shell.timer.textContent = formatDuration(0);
        this.gestureList.setMenusDisabled(true);

        // The audio track set is fixed when the recorder starts, so the
        // toggle can do nothing until the take ends. The same is true of the
        // restyle mode, which decides what the canvas draws.
        this.shell.microphoneButton.disabled = true;
        this.shell.toggleRestyleButton.disabled = true;
        this.setState('recording');

        this.shell.record.disabled = false;
        this.startStallWatchdog();

        this.shell.record.dataset.recording = 'true';
        this.shell.record.dataset.tooltip = 'Stop recording';
        this.shell.record.setAttribute('aria-label', 'Stop recording');

        // Starting a recording with audio takes the microphone from the
        // recogniser. Some builds end its session at that point and some simply
        // stop returning results, so it is restarted rather than trusted, and
        // told that the loss of the device is expected until the take ends.
        this.voice.setDeviceBusy(this.microphoneEnabled);
        this.voice.reacquire();
    }

    /**
     * Watches for the render loop stopping while a recording is running.
     *
     * A timer is used rather than a check inside the loop, because the
     * condition being detected is the loop not running. Timers continue in
     * a throttled tab; animation frames do not.
     */
    private startStallWatchdog(): void {
        this.stopStallWatchdog();
        this.lastRenderAt = performance.now();

        this.stallWatchdog = window.setInterval(() => {
            if (this.state !== 'recording') {
                return;
            }

            if (performance.now() - this.lastRenderAt < RECORDING.renderStallMs) {
                return;
            }

            this.stopStallWatchdog();
            this.abandonStalledRecording();
        }, 1000);
    }

    private stopStallWatchdog(): void {
        window.clearInterval(this.stallWatchdog);
        this.stallWatchdog = 0;
    }

    /**
     * Ends a recording that was never going to contain anything.
     *
     * The recorder is cancelled rather than stopped, because there is no
     * clip to keep, and the user is told the cause while they can still
     * act on it instead of discovering it when they press stop.
     */
    private abandonStalledRecording(): void {
        this.recorder?.cancel();
        this.recorder = null;
        this.isFinishing = false;

        this.shell.record.dataset.recording = 'false';
        this.shell.record.dataset.tooltip = 'Start recording';
        this.shell.record.setAttribute('aria-label', 'Start recording');
        this.gestureList.setMenusDisabled(false);
        this.shell.microphoneButton.disabled = !this.recordingSupport.supported;
        this.shell.toggleRestyleButton.disabled = false;

        this.fail(
            new RecordingError(
                'The picture stopped updating, so the recording was empty.',
                'This happens when the browser stops drawing a window it cannot see. Keep this tab visible and in front while recording, then try again.',
            ),
            'Recording stopped',
        );
    }

    private async finishRecording(): Promise<void> {
        if (!this.recorder || this.isFinishing) {
            return;
        }

        this.isFinishing = true;
        this.stopStallWatchdog();

        this.shell.record.disabled = true;
        this.shell.record.dataset.recording = 'false';
        this.shell.record.dataset.tooltip = 'Start recording';
        this.shell.record.setAttribute('aria-label', 'Start recording');

        try {
            this.clip = await this.recorder.stop();
        } catch (error) {
            this.recorder = null;
            this.isFinishing = false;
            this.fail(error, 'The recording could not be saved');
            return;
        }

        this.recorder = null;
        this.isFinishing = false;
        this.timeline.clear();
        this.gestureList.clearHighlights();
        this.gestureList.setMenusDisabled(false);
        this.shell.microphoneButton.disabled = !this.recordingSupport.supported;
        this.shell.toggleRestyleButton.disabled = false;
        this.toast.hide();

        // A take recorded clean is kept as the input to a restyle. One recorded
        // normally is not, because the window is already in its pixels and a
        // model asked to redraw it would redraw that too.
        this.rawTake = this.restyleArmed && this.quadTrack.everOpened ? this.clip.blob : null;

        this.frameGuide.hide();
        this.applyRestyleAvailability();

        // The take is over, so the device is closed and the recogniser is
        // restarted for the same reason it was restarted when the take began.
        this.microphone.close();
        this.voice.setDeviceBusy(false);
        this.voice.reacquire();

        this.review.present(this.clip);
        this.setState('review');

        if (this.restyleArmed && !this.rawTake) {
            this.toast.show('Raw take', 'no window was open, so there is nothing to restyle');
        }
    }

    private canShare(): boolean {
        return this.recordingSupport.mimeType
            ? canShareVideo(this.recordingSupport.mimeType)
            : false;
    }

    /**
     * Saves the recording to this device.
     *
     * Always available, because it is the route that works everywhere. On a
     * desktop it is also the one the user expects.
     */
    private downloadRecording(): void {
        if (!this.clip) {
            return;
        }

        downloadRecording({ blob: this.clip.blob, mimeType: this.clip.mimeType });
    }

    /**
     * Passes the recording to the operating system's share sheet.
     *
     * Offered alongside the download rather than instead of it. On a phone this
     * reaches the photo library or another application directly, which is where
     * a video made for a feed is going, but a user who wants the file itself
     * should not have to go through a share sheet to get it.
     *
     * A dismissed sheet is a normal outcome and leaves the panel open. A genuine
     * failure falls back to a download rather than losing the take.
     */
    private async shareRecording(): Promise<void> {
        if (!this.clip) {
            return;
        }

        const target = { blob: this.clip.blob, mimeType: this.clip.mimeType };

        try {
            await shareRecording(target);
        } catch (error) {
            console.warn('[gesture-fx] sharing failed, falling back to a download', error);
            downloadRecording(target);
        }
    }

    // =====================================================================
    // Failure
    // =====================================================================

    /** Presents a failure and moves to the error state. */
    private fail(error: unknown, title: string): void {
        console.error(`[gesture-fx] ${title}`, error);

        this.stopLoop();
        this.countdown.hide();
        this.state = 'error';

        this.overlays.setError(toPresentableError(error, title), {
            title: this.shell.errorTitle,
            message: this.shell.errorMessage,
            remedy: this.shell.errorRemedy,
        });
    }

    /** Releases the camera, the model and the GPU resources. */
    dispose(): void {
        this.stopLoop();
        this.stopStallWatchdog();
        this.countdown.cancel();
        this.recorder?.cancel();
        this.review.release();
        this.camera.stop();
        this.microphone.release();
        this.tracker.close();
        this.renderer?.dispose();
        this.viewfinder.dispose();
    }
}
