import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { Connection, Client } from '@temporalio/client';
import { 
  trailWatchWorkflow, 
  checkInSafeSignal, 
  updateLocationSignal, 
  getHikerStatusQuery 
} from './workflows';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let temporalClient: Client;
const taskQueue = process.env.TASK_QUEUE_NAME || 'trailwatch-tasks';

async function initClient() {
 const connection = await Connection.connect({
  address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233',
});
  temporalClient = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });
}


app.post('/api/hike/start', async (req, res) => {
  try {
    const { hikerName, trailName, durationMinutes, contactEmail } = req.body;
    const workflowId = `trailwatch-${Date.now()}`;

    const handle = await temporalClient.workflow.start(trailWatchWorkflow, {
      taskQueue,
      workflowId,
      args: [{
        hikerName,
        trailName,
        expectedDurationMinutes: Number(durationMinutes),
        emergencyContactEmail: contactEmail,
      }],
    });

    res.json({ success: true, workflowId: handle.workflowId });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hike/safe', async (req, res) => {
  try {
    const { workflowId } = req.body;
    const handle = temporalClient.workflow.getHandle(workflowId);
    await handle.signal(checkInSafeSignal);
    res.json({ success: true, message: 'Safety check-in acknowledged.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hike/ping', async (req, res) => {
  try {
    const { workflowId, lat, lng, accuracy } = req.body;
    const handle = temporalClient.workflow.getHandle(workflowId);
    await handle.signal(updateLocationSignal, {
      lat: Number(lat),
      lng: Number(lng),
      accuracy: Number(accuracy) || 0,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, message: 'Location updated.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/hike/:workflowId', async (req, res) => {
  try {
    const handle = temporalClient.workflow.getHandle(req.params.workflowId);
    const state = await handle.query(getHikerStatusQuery);
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
initClient().then(() => {
  app.listen(PORT, () => console.log(`[API Server] Running on http://localhost:${PORT}`));
});