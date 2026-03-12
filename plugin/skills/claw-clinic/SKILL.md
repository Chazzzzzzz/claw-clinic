---
name: claw-clinic
description: Run a full diagnostic workflow — validate, collect evidence, diagnose, and auto-treat agent health issues.
command-dispatch: tool
command-tool: clinic_diagnose
command-arg-mode: raw
---

Invoke `clinic_diagnose` with the user's message as the `symptoms` parameter. The tool handles the full workflow automatically:
1. Local validation (checks if OpenClaw gateway and AI providers are reachable)
2. Evidence collection (config, logs, connectivity, environment, runtime)
3. Backend AI diagnosis
4. Auto-execution of treatment steps

If a treatment step requires user input, it pauses and returns instructions. Use `clinic_treat` to provide the input and resume.
