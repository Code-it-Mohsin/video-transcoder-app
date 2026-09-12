console.log('Config complete')

import "dotenv/config"
import { SQSClient } from "@aws-sdk/client-sqs"

const sqsConfig = {
  credentials:{
    accessKeyId: process.env.AWS_ADMIN_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_ADMIN_SECRET_KEY!,
  }
}
const sqsClient = new SQSClient(sqsConfig)

async function init(){
  console.log(`sqsClient is running`)
}
init()