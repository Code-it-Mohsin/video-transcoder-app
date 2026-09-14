import 'dotenv/config'
import { GetObjectCommand, s3Client, PutObjectCommand, Bucket$ } from '@aws-sdk/client-s3'
import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'

const RESOLUTIONS = [
  { name: "360p", width: 480, height: 360 },
  { name: "480p", width: 858, height: 480 },
  { name: "720p", width: 1280, height: 720 },
]

const s3Client = new s3Client({
  // shared with the current terminal, and is stored in the terminal env
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID, 
    secretAccessKey: process.env.AWS_ACCESS_SECRET_KEY,
  }
})

const BUCKET_NAME = process.env.BUCKET_NAME
const BUCKET_KEY = process.env.BUCKET_KEY

// Start the transcoder
// Upload the video

async function init() {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: BUCKET_KEY,
    // body?
  })
  const result = await s3Client.send(command)
  const originalFilePath = `videos/original-video,mp4`
  await fs.writeFile(originalFilePath, result.Body)

  const originalVideoPath = path.resolve(originalFilePath)

  // Start the transcoder

  const promises = RESOLUTIONS.map(resolution => {
    const output = `transcoded/video-${resolution.name}.mp4`

    return new Promise((resolve) => {
      ffmpeg(originalVideoPath)
        .output(output)
        .withVideoCodec("libx264")
        .withAudioCodec("aac")
        .withSize(`${resolution.width}x${resolution.height}`)
        .on("end", async () => {
          const putObjectCommand = new PutObjectCommand({
            Bucket: "admin-video-transcoder-prod",
            Key: output
          })
          await s3Client.send(putObjectCommand)
          console.log(`Uploaded ${Bucket$}`)
          resolve()
        })
        .format("mp4")
        .run()
    })
  })

  await Promise.all(promises)
}
init().finally(process.exit(0))

