/**
 * File: scripts/ui/gesture-list.ts
 * Author: Amey Thakur
 * GitHub: https://github.com/Amey-Thakur
 * Repository: https://github.com/Amey-Thakur/GESTURE-FX
 * Release Date: August 31 2026
 * License: MIT
 *
 * Tech Stack: TypeScript (ES2022), DOM
 *
 * Description:
 * Builds the gesture list beside the viewfinder, lights a row when its gesture
 * fires, and lets the user choose which effect each gesture triggers.
 *
 * The list is not decoration. It is the only place the available gestures are
 * visible while recording, and the brief highlight when one fires is what tells
 * the user which movement was recognised, which matters when an effect could
 * plausibly have come from either of two gestures.
 *
 * Each row carries two controls. The first is a switch, because a gesture that
 * keeps firing by accident should be removable without leaving the page, which
 * is more useful than any threshold this project could pick on the user's
 * behalf. The second is a menu binding the gesture to an effect, which exists
 * because gestures and effects are genuinely independent registries; exposing
 * that in the interface is the honest presentation of the architecture rather
 * than a feature bolted onto it.
 */

import { EFFECTS } from '../effects/registry';
import type { EffectId } from '../effects/types';
import type { GestureDetector, GestureId } from '../gestures/types';
import { ARXIV_MARK, GESTURE_ICONS, RECORDING_CUE_ICON } from './icons';

/** How long a row stays lit after its gesture fires, in milliseconds. */
const FLASH_MS = 700;

export type GestureToggleHandler = (id: GestureId, enabled: boolean) => void;
export type EffectBindingHandler = (id: GestureId, effectId: EffectId) => void;

export interface GestureListHandlers {
    onToggle: GestureToggleHandler;
    onRebind: EffectBindingHandler;
}

export class GestureList {
    private readonly rows = new Map<GestureId, HTMLElement>();
    private readonly timers = new Map<GestureId, number>();

    /** The recording row, which is not keyed by a gesture identifier. */
    private cueRow: HTMLElement | null = null;
    private cueToggle: HTMLButtonElement | null = null;
    private cueTimer = 0;

    constructor(private readonly container: HTMLElement) {}

    /** Renders one row per registered gesture. */
    build(detectors: readonly GestureDetector[], handlers: GestureListHandlers): void {
        this.container.replaceChildren();
        this.rows.clear();
        this.cueRow = null;
        this.cueToggle = null;

        for (const detector of detectors) {
            const row = this.createRow(detector, handlers);
            this.rows.set(detector.id, row);
            this.container.append(row);
        }
    }

    /**
     * Appends the row for the recording poses.
     *
     * It sits with the gestures rather than in settings alone, because this is
     * the list a user reads to learn what their hands can do and the only one
     * visible while a take is running. It carries no effect menu: the poses are
     * bound to the recorder and cannot be pointed at something else, which is
     * the honest presentation of what they are rather than a menu with one
     * entry.
     */
    addRecordingCue(enabled: boolean, onToggle: (enabled: boolean) => void): void {
        const row = document.createElement('div');
        row.className = 'chip';
        row.dataset.gesture = 'recording-cue';
        row.dataset.enabled = String(enabled);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'chip__toggle';
        toggle.setAttribute('aria-pressed', String(enabled));
        toggle.dataset.tooltip =
            'Hold a ring, thumb and index tips together with the other three fingers up, '
            + 'to start a take. Hold an open palm to stop. Select to switch these off.';
        toggle.setAttribute(
            'aria-label',
            'Record. Hold a ring to start a take, hold an open palm to stop.',
        );

        const icon = document.createElement('span');
        icon.className = 'chip__icon';
        icon.innerHTML = RECORDING_CUE_ICON;

        const label = document.createElement('span');
        label.className = 'chip__label';
        label.textContent = 'Record';

        toggle.append(icon, label);

        const note = document.createElement('span');
        note.className = 'chip__note';
        note.textContent = 'Ring · Palm';

        toggle.addEventListener('click', () => {
            const on = toggle.getAttribute('aria-pressed') !== 'true';

            toggle.setAttribute('aria-pressed', String(on));
            row.dataset.enabled = String(on);
            onToggle(on);
        });

        row.append(toggle, note);

        this.cueRow = row;
        this.cueToggle = toggle;
        this.container.append(row);
    }

    /** Puts the recording row in step with the setting, changed elsewhere. */
    setRecordingCueEnabled(enabled: boolean): void {
        if (!this.cueRow || !this.cueToggle) {
            return;
        }

        this.cueToggle.setAttribute('aria-pressed', String(enabled));
        this.cueRow.dataset.enabled = String(enabled);
    }

    /** Lights the recording row when a pose completes. */
    flashRecordingCue(): void {
        if (!this.cueRow) {
            return;
        }

        window.clearTimeout(this.cueTimer);
        this.cueRow.dataset.fired = 'true';

        this.cueTimer = window.setTimeout(() => {
            if (this.cueRow) {
                this.cueRow.dataset.fired = 'false';
            }
        }, FLASH_MS);
    }

    private createRow(detector: GestureDetector, handlers: GestureListHandlers): HTMLElement {
        const row = document.createElement('div');
        row.className = 'chip';
        row.dataset.gesture = detector.id;

        const toggle = this.createToggle(detector, handlers.onToggle, row);
        const menu = this.createEffectMenu(detector, handlers.onRebind);

        row.append(toggle, menu);

        // The palm flip is the one the paper is about: the criterion, the
        // theorem and every measured figure describe the instant a palm turns
        // over. It was indistinguishable from the other four, so it carries the
        // accent and the mark.
        //
        // The mark goes on a line of its own beneath the two controls. Set
        // beside them it had to come out of the width of the name or the width
        // of the menu, and in a 254px panel there was no width to take: it
        // landed on top of the word it was meant to annotate. A line of its own
        // costs height, which the panel has, and leaves every row's name and
        // menu on exactly the same two edges.
        if (detector.id === 'palm-flip') {
            row.dataset.signature = 'true';
            row.append(this.createPaperLink());
        }

        return row;
    }

    /** The paper behind the palm flip, linked from the row it describes. */
    private createPaperLink(): HTMLAnchorElement {
        const link = document.createElement('a');
        link.className = 'chip__paper';
        link.href = 'https://arxiv.org/abs/2609.13269';
        link.target = '_blank';
        link.rel = 'noopener';
        link.dataset.tooltip =
            'This gesture is the subject of the paper. Its detection criterion is '
            + 'stated as a theorem and measured against a corpus with exact crossing times.';
        link.setAttribute('aria-label', 'Read the paper behind the palm flip, arXiv 2609.13269');

        const identifier = document.createElement('span');
        identifier.className = 'chip__paper-id';
        identifier.textContent = '2609.13269';

        link.innerHTML = ARXIV_MARK;
        link.append(identifier);

        return link;
    }

    /** The icon, the name, and the switch that enables the gesture. */
    private createToggle(
        detector: GestureDetector,
        onToggle: GestureToggleHandler,
        row: HTMLElement,
    ): HTMLButtonElement {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'chip__toggle';
        toggle.setAttribute('aria-pressed', 'true');
        toggle.dataset.tooltip = `${detector.instruction} Select to switch this gesture off.`;
        toggle.setAttribute('aria-label', `${detector.label}. ${detector.instruction}`);

        const icon = document.createElement('span');
        icon.className = 'chip__icon';
        icon.innerHTML = GESTURE_ICONS[detector.id];

        const label = document.createElement('span');
        label.className = 'chip__label';
        label.textContent = detector.label;

        toggle.append(icon, label);

        toggle.addEventListener('click', () => {
            const enabled = toggle.getAttribute('aria-pressed') === 'true';
            toggle.setAttribute('aria-pressed', String(!enabled));
            row.dataset.enabled = String(!enabled);
            onToggle(detector.id, !enabled);
        });

        row.dataset.enabled = 'true';

        return toggle;
    }

    /** The menu that binds this gesture to an effect. */
    private createEffectMenu(
        detector: GestureDetector,
        onRebind: EffectBindingHandler,
    ): HTMLSelectElement {
        const menu = document.createElement('select');
        menu.className = 'chip__select';
        menu.setAttribute('aria-label', `Effect fired by ${detector.label}`);
        menu.dataset.tooltip = `Choose the effect ${detector.label.toLowerCase()} fires.`;

        for (const effect of EFFECTS) {
            const option = document.createElement('option');
            option.value = effect.id;
            option.textContent = effect.label;
            option.selected = effect.id === detector.effectId;
            menu.append(option);
        }

        menu.addEventListener('change', () => {
            onRebind(detector.id, menu.value as EffectId);
        });

        return menu;
    }

    /** Lights the row for a gesture that has just fired. */
    flash(id: GestureId): void {
        const row = this.rows.get(id);

        if (!row) {
            return;
        }

        window.clearTimeout(this.timers.get(id));
        row.dataset.fired = 'true';

        this.timers.set(
            id,
            window.setTimeout(() => {
                delete row.dataset.fired;
                this.timers.delete(id);
            }, FLASH_MS),
        );
    }

    /** Clears every highlight, used when a recording ends. */
    clearHighlights(): void {
        this.timers.forEach((timer) => window.clearTimeout(timer));
        this.timers.clear();
        this.rows.forEach((row) => delete row.dataset.fired);
    }

    /** Disables the effect menus, which is done while a recording runs. */
    setMenusDisabled(disabled: boolean): void {
        this.container.querySelectorAll<HTMLSelectElement>('.chip__select').forEach((menu) => {
            menu.disabled = disabled;
        });
    }
}
