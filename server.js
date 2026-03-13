const http = require('http');
const PORT = parseInt(process.env.PORT || '3001', 10);
console.log('[test] Starting on PORT=' + PORT);
http.createServer((req, res) => {
  console.log('[test] Request:', req.url);
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ok:true,port:PORT,url:req.url}));
}).listen(PORT, '0.0.0.0', () => console.log('[test] Listening on 0.0.0.0:' + PORT));

