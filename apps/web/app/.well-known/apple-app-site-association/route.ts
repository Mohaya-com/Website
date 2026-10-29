/**
 * iOS Universal Links association. Configure IOS_APP_IDS="TEAMID.com.example.vms" (comma-separated).
 * When not configured, an empty association is returned and links open in the browser (web fallback).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const appIDs = (process.env.IOS_APP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const body = {
    applinks: {
      details: appIDs.length ? [{ appIDs, components: [{ '/': '/g/*' }, { '/': '/p' }, { '/': '/visitor/*' }] }] : [],
    },
  };
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
