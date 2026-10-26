/**
 * Pixel Golf's typeface: Lato (Google Fonts, SIL Open Font License, licence in assets/fonts/OFL.txt).
 * Every Label and TextShape points at one of these with fontSrc, with font: 'sans-serif' (the
 * built-in face) as the fallback. The fallback is what shows on the Decentraland mobile app (it
 * doesn't support custom fonts yet), in a plain local preview (Lato needs Play Options > Desktop
 * Client > Compress Assets), and on a newly deployed scene until its fonts are processed.
 * Bold: titles, numbers, buttons and the small capitals headings. Regular: everything else.
 */
export const FONT_REGULAR = 'assets/fonts/Lato-Regular.ttf'
export const FONT_BOLD = 'assets/fonts/Lato-Bold.ttf'
