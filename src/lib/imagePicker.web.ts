import type { ImagePicker, PickedImage } from './imagePicker';

/**
 * Choosing an image file on the web.
 *
 * A hidden `<input type="file">` rather than a library: the browser already has a
 * native, accessible, permission-free file picker, and it needs no dependency and
 * no native build. This is the reason the web app can upload a profile picture
 * while native cannot — see `imagePicker.ts`.
 *
 * The element is created per call and removed afterwards, so nothing persists in
 * the DOM between uses.
 */

/** Mirrors the bucket's `allowed_mime_types`. The server rejects anything else. */
const ACCEPT = 'image/jpeg,image/png,image/webp';

export const imagePicker: ImagePicker = {
  supported: true,
  unsupportedReason: null,

  pick: () =>
    new Promise<PickedImage | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = ACCEPT;
      // Kept out of the layout but still clickable, which is how a file input has
      // to be driven programmatically.
      input.style.position = 'fixed';
      input.style.left = '-9999px';

      let settled = false;
      const finish = (result: PickedImage | null) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(result);
      };

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        finish({
          file,
          fileName: file.name,
          // Browsers occasionally report an empty type for an unusual extension;
          // the upload then validates and the server has the final say.
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
      });

      /**
       * Dismissal.
       *
       * `cancel` is not universally supported, so a window focus that arrives with
       * no file selected is treated as a dismissal too. Without this the promise
       * would never settle and a spinner would spin forever.
       */
      input.addEventListener('cancel', () => finish(null));
      window.addEventListener(
        'focus',
        () => {
          setTimeout(() => {
            if (!input.files?.length) finish(null);
          }, 400);
        },
        { once: true },
      );

      document.body.appendChild(input);
      input.click();
    }),
};
