import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import dotenv from 'dotenv';
dotenv.config();

export async function startWorker() {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const taskQueue = process.env.TASK_QUEUE_NAME || 'trailwatch-tasks';

  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  console.log(`[Worker] Polling queue: ${taskQueue} on ${address}`);
  await worker.run();
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error('[Worker Fatal Error]:', err);
    process.exit(1);
  });
}