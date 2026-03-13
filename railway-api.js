const https = require('https');

const TOKEN = '8acd7436-68f4-416b-8f96-f466398ddf41';
const PROJECT_ID = 'e0c9fde1-260c-44dd-b155-f56e43365950';
const ENV_ID = '427a002a-3c3f-48eb-bf7d-eb19474b7311';
const SERVICE_ID = 'e8a9b484-a680-4e18-9dab-c2633c7ed98a';
const LATEST_FAILED_DEP = 'c90cca95-3658-4899-aba6-5cde037b4c4d';

function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const opts = {
      hostname: 'backboard.railway.app',
      path: '/graphql/v2',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b))); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  // Get build logs of latest failed deployment
  const logs = await gql(`{
    buildLogs(deploymentId: "${LATEST_FAILED_DEP}", limit: 100) {
      message severity timestamp
    }
  }`);
  console.log('BUILD LOGS:', JSON.stringify(logs, null, 2));
}

main().catch(console.error);






