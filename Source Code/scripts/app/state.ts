/**
 * File: scripts/app/state.ts
 * Author: Amey Thakur
 * GitHub: https://github.com/Amey-Thakur
 * Repository: https://github.com/Amey-Thakur/GESTURE-FX
 * Release Date: August 31 2026
 * License: MIT
 *
 * Tech Stack: TypeScript (ES2022)
 *
 * Description:
 * The application's states and the transitions between them.
 *
 * The machine is written out here rather than left implicit in a set of
 * booleans, because the states are mutually exclusive and the bugs that arise
 * from treating them otherwise are the expensive kind: a recording that starts
 * while the permission card is up, or a countdown that keeps running after an
 * error has replaced the interface.
 *
 *   boot ──▶ guide ──▶ permission ──▶ loading ──▶ ready
 *                                                  │
 *                        review ◀── recording ◀── countdown
 *                          │                        │
 *                          └────────▶ ready ◀───────┘
 *
 *   error is reachable from every state and returns to permission on retry.
 */

export type AppState =
    /** Nothing has started; support is being probed. */
    | 'boot'
    /** The guide is open, asked for from "How it works". */
    | 'guide'
    /** The settings panel is open over whatever was showing. */
    | 'settings'
    /** The method panel is open over whatever was showing. */
    | 'method'
    /** The restyle panel is open over the review. */
    | 'restyle'
    /** Waiting for the user to allow the camera. */
    | 'permission'
    /** The tracking runtime and model are downloading. */
    | 'loading'
    /** Live preview with gesture detection, not recording. */
    | 'ready'
    /** Counting down to the start of a recording. */
    | 'countdown'
    /** Recording. */
    | 'recording'
    /** A finished recording is being reviewed. */
    | 'review'
    /** A failure is being presented. */
    | 'error';

/** The states in which the render loop should be running. */
export const LIVE_STATES: ReadonlySet<AppState> = new Set<AppState>([
    'ready',
    'countdown',
    'recording',
    // Settings keeps the loop running so the preview behind the panel stays
    // live and a change to sensitivity or mirroring is visible immediately.
    'settings',
    // The method panel is read while the camera runs, for the same reason.
    'method',
]);

/** The states in which the record control is usable. */
export const RECORDABLE_STATES: ReadonlySet<AppState> = new Set<AppState>([
    'ready',
    'recording',
]);
