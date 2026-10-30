const SQUARE_SIZE = 256

/**
 * `file` cropped to its centered square and shrunk to SQUARE_SIZE, as WebP
 * (PNG where the browser can't encode WebP). Rejects if it isn't an image
 * the browser can read.
 */
export async function squareImage(file: Blob, size = SQUARE_SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(size, side)
  const context = canvas.getContext('2d')
  if (!context) throw new Error("Couldn't read the image.")
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't read the image."))),
      'image/webp',
      0.9,
    ),
  )
}
