import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export interface Coordinates {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: string;
}

export interface HikerSession {
  hikerName: string;
  trailName: string;
  expectedDurationMinutes: number;
  emergencyContactEmail: string;
  emergencyContactPhone?: string;
  lastCoordinates?: Coordinates;
}

export async function fetchTrailWeather(
  trailName: string,
  lastCoords?: Coordinates
): Promise<string> {
  try {
    const lat = lastCoords?.lat ?? 28.367;
    const lng = lastCoords?.lng ?? 79.430;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code&hourly=temperature_2m,precipitation_probability&forecast_days=1`;

    const res = await fetch(weatherUrl);
    if (!res.ok) {
      throw new Error(`Open-Meteo returned status ${res.status}`);
    }

    const data = (await res.json()) as any;
    const current = data.current;

    return `LIVE METEOROLOGICAL OBSERVATION (Latitude: ${lat}, Longitude: ${lng})
- Current Temperature: ${current.temperature_2m}°C (Feels like: ${current.apparent_temperature}°C)
- Relative Humidity: ${current.relative_humidity_2m}%
- Wind Speed: ${current.wind_speed_10m} km/h
- Current Precipitation: ${current.precipitation} mm
- Location Source: ${lastCoords ? 'Exact Last Known Hiker Device Ping' : 'Trailhead Area Estimate'}`;
  } catch (err: any) {
    console.error('Weather fetch error:', err.message);
    return 'Live weather telemetry unreachable. Search parties should assume exposure risk and drop in temperature.';
  }
}

/**
 * 2. STRUCTURED RESCUE PACKET:
 * Builds both plain text and rich HTML email bodies.
 */
export async function buildRescuePacket(
  session: HikerSession, 
  weather: string
): Promise<{ text: string; html: string }> {
  const mapsUrl = session.lastCoordinates
    ? `https://www.google.com/maps?q=${session.lastCoordinates.lat},${session.lastCoordinates.lng}`
    : 'No GPS coordinates recorded';

  const plainText = `=====================================================
🚨 EMERGENCY SEARCH & RESCUE DISPATCH ALERT 🚨
=====================================================
SUBJECT: Hiker overdue past designated safety window.
HIKER NAME: ${session.hikerName}
FILED TRAIL ROUTE: ${session.trailName}
SAFETY WINDOW DURATION: ${session.expectedDurationMinutes} minutes

LAST REGISTERED LOCATION:
- Coordinates: ${session.lastCoordinates ? `${session.lastCoordinates.lat},${session.lastCoordinates.lng}` : 'N/A'}
- Map Link: ${mapsUrl}
- Last Ping Timestamp: ${session.lastCoordinates?.timestamp || 'None received'}

ENVIRONMENTAL & WEATHER CONDITIONS:
${weather}

RECOMMENDED ACTION:
1. Contact local wilderness ranger station or search and rescue authorities.
2. Provide this report and deploy search teams along the ${session.trailName} route.
=====================================================`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #1c1917; color: #f5f5f4; padding: 24px; border-radius: 12px; max-width: 600px;">
      <h2 style="color: #ef4444; margin-top: 0;">🚨 Urgent: Safety Check-in Overdue</h2>
      <p style="font-size: 15px; color: #d6d3d1;">
        Hiker <strong>${session.hikerName}</strong> failed to check in after the scheduled <strong>${session.expectedDurationMinutes}-minute</strong> window.
      </p>

      <div style="background-color: #292524; border-left: 4px solid #ef4444; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <h4 style="margin: 0 0 8px 0; color: #fafaf9;">Route Details</h4>
        <p style="margin: 4px 0; font-size: 14px;"><strong>Trail Name:</strong> ${session.trailName}</p>
        <p style="margin: 4px 0; font-size: 14px;"><strong>Last Known GPS:</strong> ${session.lastCoordinates ? `${session.lastCoordinates.lat},${session.lastCoordinates.lng}` : 'No fix logged'}</p>
        <p style="margin: 4px 0; font-size: 14px;"><strong>Timestamp:</strong> ${session.lastCoordinates?.timestamp || 'N/A'}</p>
        ${
          session.lastCoordinates
            ? `<p style="margin-top: 10px;"><a href="${mapsUrl}" style="background-color: #ef4444; color: white; padding: 8px 14px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 13px; display: inline-block;">Open Coordinates in Google Maps</a></p>`
            : ''
        }
      </div>

      <div style="background-color: #292524; border-left: 4px solid #0284c7; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <h4 style="margin: 0 0 8px 0; color: #fafaf9;">Environmental & Weather Conditions</h4>
        <pre style="white-space: pre-wrap; font-family: monospace; font-size: 13px; color: #38bdf8; margin: 0;">${weather}</pre>
      </div>

      <p style="font-size: 13px; color: #a8a29e; margin-bottom: 0;">
        This alert was generated automatically by <strong>TrailWatch</strong> via Temporal durable execution.
      </p>
    </div>
  `;

  return { text: plainText, html };
}

/**
 * 3. PRODUCTION RESEND EMAIL SENDER:
 * Delivers alerts to any valid recipient specified by the hiker.
 */
export async function notifyEmergencyContact(
  contactEmail: string,
  rescuePacket: { text: string; html: string }
): Promise<boolean> {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not defined in environment variables');
    }

    const sender = process.env.EMAIL_FROM || 'TrailWatch <alerts@trailwatch.dev>';

    const { data, error } = await resend.emails.send({
      from: sender,
      to: [contactEmail],
      subject: '🚨 URGENT: Search & Rescue Check-in Overdue',
      text: rescuePacket.text,
      html: rescuePacket.html,
    });

    if (error) {
      console.error('❌ Resend API error:', error.message);
      return false;
    }

    console.log(`✅ [RESEND DISPATCH SUCCESSFUL] Email ID: ${data?.id} delivered to ${contactEmail}`);
    return true;
  } catch (err: any) {
    console.error('❌ Failed to dispatch email via Resend:', err.message);
    return false;
  }
}

// Add to src/activities.ts:

export async function sendStandDownNotification(
  session: HikerSession
): Promise<boolean> {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn('⚠️ RESEND_API_KEY is not defined in .env');
      return false;
    }

    const sender = process.env.EMAIL_FROM || 'TrailWatch <alerts@trailwatch.dev>';
    const safeTime = new Date().toLocaleTimeString();

    const plainText = `=====================================================
✅ SEARCH & RESCUE STAND-DOWN NOTIFICATION ✅
=====================================================
SUBJECT: Hiker has safely checked in.
HIKER NAME: ${session.hikerName}
TRAIL: ${session.trailName}
STATUS: SAFE AND ACCOUNTED FOR
CHECK-IN TIME: ${safeTime}

The overdue alert previously sent for this hiker can be canceled. No rescue action is required.
=====================================================`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #064e3b; color: #ecfdf5; padding: 24px; border-radius: 12px; max-width: 600px;">
        <h2 style="color: #34d399; margin-top: 0;">✅ Stand-Down: Hiker is Safe</h2>
        <p style="font-size: 15px; color: #d1fae5;">
          Hiker <strong>${session.hikerName}</strong> has just checked in as <strong>SAFE</strong> at <strong>${safeTime}</strong>.
        </p>
        <div style="background-color: #065f46; border-left: 4px solid #34d399; padding: 16px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 4px 0; font-size: 14px;"><strong>Trail:</strong> ${session.trailName}</p>
          <p style="margin: 4px 0; font-size: 14px;"><strong>Status:</strong> Active search alert resolved.</p>
        </div>
        <p style="font-size: 13px; color: #a7f3d0; margin-bottom: 0;">
          Previous emergency alerts regarding this excursion are officially closed.
        </p>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: sender,
      to: [session.emergencyContactEmail],
      subject: `✅ ALL CLEAR: ${session.hikerName} Has Checked In Safe`,
      text: plainText,
      html: html,
    });

    if (error) {
      console.error('❌ Stand-down email error:', error.message);
      return false;
    }

    console.log(`✅ [STAND-DOWN EMAIL SENT] Delivered to ${session.emergencyContactEmail}`);
    return true;
  } catch (err: any) {
    console.error('❌ Failed to dispatch stand-down email:', err.message);
    return false;
  }
} 