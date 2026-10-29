/**
 * Android App Links verification. Configure ANDROID_PACKAGE and ANDROID_SHA256_CERT_FINGERPRINTS (comma-separated).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const pkg = process.env.ANDROID_PACKAGE?.trim();
  const fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const body = pkg && fingerprints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints } }] : [];
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
