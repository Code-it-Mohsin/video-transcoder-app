import "dotenv/config"
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { createWriteStream, createReadStream } from "fs"
import { pipeline } from "stream/promises"
import path from "path"
import ffmpeg from "fluent-ffmpeg"

const RESOLUTIONS = [
  { name: "360p", width: 480, height: 360 },
  { name: "480p", width: 858, height: 480 },
  { name: "720p", width: 1280, height: 720 },
]

const RAW_BUCKET_NAME = process.env.BUCKET_NAME
const RAW_BUCKET_KEY = process.env.BUCKET_KEY
const PROD_BUCKET_NAME = process.env.PROD_BUCKET_NAME || "admin-video-transcoder-prod"

// If explicit keys are set (local testing via .env), use them.
// On ECS with a task role attached to the Task Definition, leave these unset -
// the SDK's default credential chain will automatically pick up the
// temporary credentials ECS injects for the task role.
const s3Client = new S3Client({
  region: "us-east-1",
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ACCESS_SECRET_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_ACCESS_SECRET_KEY,
        },
      }
    : {}),
})

async function downloadOriginal() {
  const command = new GetObjectCommand({
    Bucket: RAW_BUCKET_NAME,
    Key: RAW_BUCKET_KEY,
  })

  const result = await s3Client.send(command)
  const originalFilePath = path.resolve("original-video.mp4")

  // result.Body is a readable stream, not a Buffer - stream it straight to
  // disk instead of buffering the whole video in memory
  await pipeline(result.Body, createWriteStream(originalFilePath))

  return originalFilePath
}

function transcode(originalVideoPath, resolution) {
  const output = `video-${resolution.name}.mp4`

  return new Promise((resolve, reject) => {
    ffmpeg(originalVideoPath)
      .output(output)
      .withVideoCodec("libx264")
      .withAudioCodec("aac")
      .withSize(`${resolution.width}x${resolution.height}`)
      .format("mp4")
      .on("end", () => resolve(output))
      .on("error", (err) => reject(err)) // previously missing - a failed transcode hung forever
      .run()
  })
}

async function uploadOutput(output) {
  const putObjectCommand = new PutObjectCommand({
    Bucket: PROD_BUCKET_NAME,
    Key: output,
    Body: createReadStream(path.resolve(output)), // was: fs.createReadStream(path.resolve) - missing the actual path
  })
  await s3Client.send(putObjectCommand)
  console.log(`Uploaded ${output} to ${PROD_BUCKET_NAME}`)
}

async function init() {
  const originalVideoPath = await downloadOriginal()

  await Promise.all(
    RESOLUTIONS.map(async (resolution) => {
      const output = await transcode(originalVideoPath, resolution)
      await uploadOutput(output)
    })
  )
}

init()
  .catch((err) => {
    console.error("Transcoding failed:", err)
    process.exitCode = 1
  })
  .finally(() => process.exit()) // was: .finally(process.exit(0)) - that called process.exit() immediately, not on settle