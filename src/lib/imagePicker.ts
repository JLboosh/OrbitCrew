/**
 * Choosing an image file, per platform.
 *
 * This is the NATIVE implementation, and it deliberately reports "unsupported"
 * rather than pretending. Picking an image on iOS or Android needs
 * `expo-image-picker`, which is a native module: adding it means every developer
 * on the project moves from Expo Go to a development build (`npx expo prebuild`),
 * which is a bigger decision than one screen. The same reasoning is already
 * written down for device location in `deviceLocation.ts`.
 *
 * Callers must branch on `supported` and say so in the UI, exactly as the map and
 * the location gate do, instead of rendering a button that silently does nothing.
 * `imagePicker.web.ts` is the real implementation; Metro resolves it on web.
 */

export interface PickedImage {
  /** The bytes to upload. Supabase Storage accepts a Blob directly. */
  file: Blob;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ImagePicker {
  supported: boolean;
  /** Null when the member dismissed the picker. */
  pick: () => Promise<PickedImage | null>;
  /** Shown when `supported` is false, so the UI never has to invent the reason. */
  unsupportedReason: string | null;
}

export const imagePicker: ImagePicker = {
  supported: false,
  pick: async () => null,
  unsupportedReason:
    'Choosing a photo needs a development build on this platform. Upload your picture from the web app and it will appear here.',
};
