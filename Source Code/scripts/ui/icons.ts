/**
 * File: scripts/ui/icons.ts
 * Author: Amey Thakur
 * GitHub: https://github.com/Amey-Thakur
 * Repository: https://github.com/Amey-Thakur/GESTURE-FX
 * Release Date: August 31 2026
 * License: MIT
 *
 * Tech Stack: TypeScript (ES2022), SVG
 *
 * Description:
 * One line-art glyph per gesture, drawn to a common 24 unit grid with a
 * consistent stroke weight so the gesture list reads as a set.
 *
 * The icons are inline rather than loaded from a sprite or an icon package,
 * which keeps the application free of a runtime dependency for five small
 * drawings and means they inherit their colour from the surrounding text.
 */

import type { GestureId } from '../gestures/types';

/** Shared attributes, so every glyph has identical weight and joinery. */
const ATTRIBUTES =
    'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

/**
 * The arXiv wordmark, in the two colours arXiv publishes it in.
 *
 * The mark rather than the word. At this size "arXiv" set in the interface
 * font would read as one more label, and the whole point of putting it on the
 * palm flip row is that this gesture has a paper behind it. The paths are the
 * published logo unaltered, including the order they are painted in, which is
 * what makes the two strokes of the X cross the way they do.
 */
export const ARXIV_MARK =
    '<svg class="chip__paper-mark" viewBox="0 0 246.98 111.12" '
    + 'aria-hidden="true" focusable="false">'
    + '<path d="M69.41,32.88c1.86,0,3.1,1.24,3.99,3.45,1.06-2.21,2.57-3.45,4.69-3.45h14.88c2.3,0,4.07,1.86,4.07,4.07v7.83c0,2.66-1.33,4.07-4.07,4.07s-4.07-1.42-4.07-4.07v-3.75h-10.54c-1.77,0-2.66.97-2.66,2.75v27.19h10.01c2.66,0,4.07,1.33,4.07,4.07s-1.42,4.07-4.07,4.07h-26.39c-2.66,0-3.99-1.33-3.99-4.07s1.33-4.07,3.99-4.07h8.24v-29.93h-7.26c-2.66,0-3.99-1.33-3.99-4.07s1.33-4.07,3.99-4.07h9.12Z" fill="#afa497"/>'
    + '<path d="M181.07,32.88c2.66,0,4.07,1.42,4.07,4.07v34.01h10.1c2.75,0,4.07,1.33,4.07,4.07s-1.33,4.07-4.07,4.07h-28.6c-2.66,0-4.07-1.33-4.07-4.07s1.42-4.07,4.07-4.07h10.36v-29.93h-8.53c-2.74,0-4.07-1.33-4.07-4.07s1.33-4.07,4.07-4.07h12.61ZM185.29,15.27c0,3.19-2.71,5.82-5.82,5.82s-5.9-2.63-5.9-5.82,2.71-5.82,5.9-5.82,5.82,2.63,5.82,5.82Z" fill="#afa497"/>'
    + '<path d="M246.98,36.96c0,.53-.09,1.15-.27,1.59l-14.88,38.08c-.71,1.68-1.95,2.48-3.72,2.48h-5.93c-1.86,0-3.19-.8-3.81-2.48l-15.05-38.08c-.27-.44-.36-1.06-.36-1.59,0-2.3,1.86-4.07,4.16-4.07,1.86,0,3.01.97,3.72,2.66l14.35,36.13,13.9-36.13c.71-1.68,1.86-2.66,3.72-2.66,2.3,0,4.16,1.77,4.16,4.07Z" fill="#afa497"/>'
    + '<path d="M127.98,55.61l-32.74,38.85c-1.29,1.37-2.08,3.78-1.36,5.5.75,1.8,2.46,2.91,4.4,2.91,1.09,0,1.99-.38,3.16-1.56l40.19-42.71c1.6-1.69,1.62-4.33.04-6.04l-13.68,3.05Z" fill="#aa142d"/>'
    + '<path d="M127.98,55.61l31.19-38.27c1.49-1.99,2.2-3.03,1.49-4.72-.74-1.77-2.59-3.16-4.48-3.16h0c-1.06,0-1.72.09-3.01,1.11l-38.63,41.76c-1.72,1.84-1.71,4.7.02,6.53l47.79,51.07c1.02,1.05,2.05,1.19,3.14,1.19,1.93,0,3.19-1.14,4.03-2.82.72-1.73-.08-3.44-1.4-5.23l-40.12-47.46" fill="#afa497"/>'
    + '<path d="M141.67,52.56L95,2.13S93.29.04,91.48,0s-3.6,1.02-4.34,2.79c-.7,1.69-.2,2.88,1.35,5.1l40.09,48.42" fill="#aa142d"/>'
    + '<path d="M32.45,32.88c5.02,0,8.21,3.31,8.21,8.4v37.83H5.14c-2.88,0-5.14-1.87-5.14-4.93v-13.03c0-4.07,2.83-7.35,7-8.15l25.51-3.57v-8.41H4.14c-2.05,0-4.14-1.45-4.14-4.07,0-2.87,2.14-4.07,4.36-4.07h28.09ZM32.5,70.97v-13.29l-24.35,3.4v9.9h24.35Z" fill="#afa497"/>'
    + '</svg>';

/** Wraps a path set in the shared SVG element. */
function glyph(body: string): string {
    return `<svg ${ATTRIBUTES}>${body}</svg>`;
}

/**
 * The recording poses: a ring of thumb and finger, with a record dot inside it.
 *
 * Not in `GESTURE_ICONS`, because that map is keyed by the identifiers of the
 * gestures bound to effects and these two poses are bound to the recorder.
 */
export const RECORDING_CUE_ICON = glyph(`
    <circle cx="9" cy="14" r="4.4" />
    <circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12.2 10.9 15 6.6a1.3 1.3 0 0 1 2.2 1.4l-2 3.2" />
    <path d="M15.2 11.2 18 7.2a1.3 1.3 0 0 1 2.2 1.4L18 12.6a5.4 5.4 0 0 1-4.6 2.6" />
`);

export const GESTURE_ICONS: Record<GestureId, string> = {
    /** An open hand with a rotation arc around it. */
    'palm-flip': glyph(`
        <path d="M9 12V6a1.4 1.4 0 0 1 2.8 0v6" />
        <path d="M11.8 12V5a1.4 1.4 0 0 1 2.8 0v7" />
        <path d="M14.6 12V6.5a1.4 1.4 0 0 1 2.8 0V14a6 6 0 0 1-6 6 5 5 0 0 1-4.3-2.4L5 14.4" />
        <path d="M9 12V9.5a1.4 1.4 0 0 0-2.8 0V14" />
        <path d="M4 5.5A7 7 0 0 1 9 3" />
        <path d="M4 3v2.6h2.6" />
    `),

    /** A hand with motion lines trailing behind it. */
    swipe: glyph(`
        <path d="M13 12V6.2a1.4 1.4 0 0 1 2.8 0V13" />
        <path d="M15.8 13V7.4a1.4 1.4 0 0 1 2.8 0V15a5.5 5.5 0 0 1-5.5 5.5 5 5 0 0 1-4.2-2.3L6 14.6" />
        <path d="M13 12V9.6a1.4 1.4 0 0 0-2.8 0V14" />
        <path d="M6 8H2M6.5 11.5H3.5" />
    `),

    /** A closed fist. */
    fist: glyph(`
        <path d="M6 11.5V9a1.5 1.5 0 0 1 3 0v1.5" />
        <path d="M9 10.5V8.6a1.5 1.5 0 0 1 3 0v1.9" />
        <path d="M12 10.5V9a1.5 1.5 0 0 1 3 0v1.5" />
        <path d="M15 10.8V9.8a1.4 1.4 0 0 1 2.8 0V14a6 6 0 0 1-6 6H11a5 5 0 0 1-5-5v-3.5" />
    `),

    /** An open palm with an outward arrow. */
    'palm-push': glyph(`
        <path d="M11 11V5.4a1.4 1.4 0 0 1 2.8 0V11" />
        <path d="M13.8 11V4.6a1.4 1.4 0 0 1 2.8 0V11" />
        <path d="M16.6 11.4V6.4a1.4 1.4 0 0 1 2.8 0V14a6 6 0 0 1-6 6 5 5 0 0 1-4.3-2.4L7 14.4" />
        <path d="M11 11V8.6a1.4 1.4 0 0 0-2.8 0V13" />
        <path d="M4.5 9.5 2 12l2.5 2.5" />
    `),

    /** Two raised fingers. */
    victory: glyph(`
        <path d="m9.5 10.5-1.2-4a1.4 1.4 0 0 1 2.7-.8l1.3 4.4" />
        <path d="M13.2 10.4 14 5.8a1.4 1.4 0 0 1 2.8.4l-.6 5.3" />
        <path d="M16.2 11.5V9.8a1.4 1.4 0 0 1 2.8 0V14a6 6 0 0 1-6 6 5.5 5.5 0 0 1-4.7-2.6L6 13.6" />
    `),
};
