import "dotenv/config"
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs"
import type { S3Event } from "aws-lambda"
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs"

const REGION = "us-east-1"
const QUEUE_URL =
  process.env.QUEUE_URL ||
  "https://sqs.us-east-1.amazonaws.com/994327026129/admin-video-transcoding"
const CLUSTER_ARN =
  process.env.ECS_CLUSTER_ARN || "arn:aws:ecs:us-east-1:994327026129:cluster/dev"
const TASK_DEFINITION_ARN =
  process.env.ECS_TASK_DEFINITION_ARN ||
  "arn:aws:ecs:us-east-1:994327026129:task-definition/video-transcoder"
const SECURITY_GROUPS = (process.env.ECS_SECURITY_GROUPS || "sg-02cbbdb3d374e7476").split(",")
const SUBNETS = (
  process.env.ECS_SUBNETS ||
  "subnet-0715e05bdb6c6a3a8,subnet-0976d6e7788167e83,subnet-04c920da60b6a4e04,subnet-0b64ecbd0c2826d3e"
).split(",")

const config = {
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ADMIN_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_ADMIN_SECRET_KEY!,
  },
}

const sqsClient = new SQSClient(config)
const ecsClient = new ECSClient(config)

async function deleteMessage(receiptHandle: string) {
  await sqsClient.send(
    new DeleteMessageCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: receiptHandle,
    })
  )
}

async function processMessage(body: string, receiptHandle: string) {
  const event = JSON.parse(body) as S3Event & { Service?: string; Event?: string }

  // S3 fires a one-off test event the first time you wire up a bucket notification
  if ("Service" in event && event.Event === "s3:TestEvent") {
    await deleteMessage(receiptHandle)
    return
  }

  for (const record of event.Records) {
    const { bucket, object } = record.s3
    // S3 event keys are URL-encoded (spaces become '+') - must decode before use
    const key = decodeURIComponent(object.key.replace(/\+/g, " "))

    const runTaskCommand = new RunTaskCommand({
      taskDefinition: TASK_DEFINITION_ARN,
      cluster: CLUSTER_ARN,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: "ENABLED",
          securityGroups: SECURITY_GROUPS,
          subnets: SUBNETS,
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "video-transcoder",
            environment: [
              { name: "BUCKET_NAME", value: bucket.name },
              // NOTE: name must match what container/index.js reads (BUCKET_KEY),
              // this was previously sent as "KEY" and silently mismatched
              { name: "BUCKET_KEY", value: key },
            ],
          },
        ],
      },
    })

    await ecsClient.send(runTaskCommand)
  }

  // delete once per SQS message, after all its S3 records have been handled
  await deleteMessage(receiptHandle)
}

async function init() {
  const command = new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20, // long polling - this blocks up to 20s, so the while(true) loop isn't a busy-loop
  })

  while (true) {
    const { Messages } = await sqsClient.send(command)

    if (!Messages) {
      console.log("No messages, polling again...")
      continue
    }

    for (const message of Messages) {
      const { MessageId, Body, ReceiptHandle } = message
      console.log(`Message received: ${MessageId}`)

      try {
        await processMessage(Body!, ReceiptHandle!)
      } catch (error) {
        // Don't delete on failure - message returns to the queue after the
        // visibility timeout and gets retried (or lands in a DLQ, once configured)
        console.error(`Failed to process message ${MessageId}:`, error)
      }
    }
  }
}

init()