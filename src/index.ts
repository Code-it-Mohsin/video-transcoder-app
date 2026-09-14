import "dotenv/config"
import { SQSClient, ReceiveMessageCommand } from "@aws-sdk/client-sqs"
import type { S3Event } from "aws-lambda"
import {ECSClient, RunTaskCommand} from '@aws-sdk/client-ecs'

const config = {
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ADMIN_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_ADMIN_SECRET_KEY!,
  }
}
const sqsClient = new SQSClient(config)
const ecsClient = new ECSClient(config)

async function init() {

  // POLLS THE MESSAGE FROM THE BELOW QUEUE
  const command = new ReceiveMessageCommand({
    QueueUrl: "https://sqs.us-east-1.amazonaws.com/994327026129/admin-video-transcoding",
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20,
  })

  while (true) {
    const { Messages } = await sqsClient.send(command)
    if (!Messages) {
      console.log('No Messages')
      continue
    }

    try {
      for (const message of Messages) {
        const { MessageId, Body } = message
        console.log(`Message Received ${MessageId}${Body}`)

        // Validate and Parse the Body
        const event = JSON.parse(Body!) as S3Event

        if ("Service" in event && "Event" in event){
          if(event.Event === "s3:TestEvent") continue
        }
        
        for (const record of event.Records){
          const {s3} = record
          const {bucket, object: {key}} = s3
          const runTaskCommand = new RunTaskCommand({
            taskDefinition: "arn:aws:ecs:us-east-1:994327026129:task-definition/video-transcoder"
          })
        }
        
        // Spin the docker container

        // Delete the message from queue

      }

    } catch (error) {

    }
  }
}
init()