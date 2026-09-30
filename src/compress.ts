// Shrinks screenshots and screen recordings in the browser before upload,
// keeping text readable. If anything goes wrong, the original file is used.
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, canEncodeVideo } from 'mediabunny'

const MAX_IMAGE_WIDTH = 2880 // retina screenshots stay crisp; anything wider is scaled down
// Tested on a 3456px Mac recording: 27 MB → 2 MB, text sharp even while scrolling.
// (300 kbps smeared text during scrolling; 450 kbps didn't.)
const MAX_VIDEO_WIDTH = 1728
const VIDEO_FPS = 24
const VIDEO_BITRATE = 450_000

export async function compressImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || file.type === 'image/webp') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9))
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

export async function compressVideo(file: File, onProgress?: (fraction: number) => void): Promise<File> {
  try {
    if (!(await canEncodeVideo('avc'))) return file
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) return file
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: 'avc',
        width: track.displayWidth > MAX_VIDEO_WIDTH ? MAX_VIDEO_WIDTH : undefined,
        frameRate: VIDEO_FPS,
        bitrate: VIDEO_BITRATE,
        forceTranscode: true,
      },
      audio: { bitrate: 64_000 },
    })
    if (!conversion.isValid) return file
    if (onProgress) conversion.onProgress = onProgress
    await conversion.execute()
    const buffer = output.target.buffer
    if (!buffer || buffer.byteLength >= file.size) return file
    return new File([buffer], file.name.replace(/\.\w+$/, '') + '.mp4', { type: 'video/mp4' })
  } catch {
    return file
  }
}

export async function compress(file: File, onProgress?: (fraction: number) => void) {
  return file.type.startsWith('video/') ? compressVideo(file, onProgress) : compressImage(file)
}
