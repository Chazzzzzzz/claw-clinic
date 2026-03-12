import type { PluginApi } from "../types.js";
import { ClawClinicClient } from "../client.js";
import { collectAllEvidence } from "../evidence.js";
import { validateLocally } from "../validation.js";
import { ClinicNotifier } from "../notifier.js";
import { runTreatmentLoop } from "../treatment-loop.js";

export function registerClinicCommand(api: PluginApi, client: ClawClinicClient): void {
  api.registerCli(
    ({ program }) => {
      const cmd = program
        .command("claw-clinic")
        .description("Claw Clinic — diagnose and treat agent health issues");

      cmd
        .command("diagnose")
        .description("Run full diagnostic workflow: validate, collect evidence, diagnose, and auto-treat")
        .argument("[symptoms...]", "Description of the issue you're experiencing")
        .action(async (...args: unknown[]) => {
          const symptomsArr = Array.isArray(args[0]) ? args[0] as string[] : [];
          const symptoms = symptomsArr.join(" ").trim() || undefined;
          const notifier = new ClinicNotifier(api, { mode: "cli" });

          try {
            // Step 1: Local validation
            await notifier.status("Running local validation...");
            const localResult = await validateLocally(api.config);
            if (localResult.quickIssues.length > 0) {
              for (const issue of localResult.quickIssues) {
                await notifier.status(`  Issue: ${issue}`);
              }
            } else {
              await notifier.status("Local validation passed.");
            }

            // Step 2: Collect evidence
            await notifier.status("Collecting evidence...");
            const evidence = await collectAllEvidence(api.config);

            if (symptoms) {
              evidence.push({ type: "behavior", description: symptoms });
            }
            if (localResult.quickIssues.length > 0) {
              evidence.push({ type: "behavior", description: "Local validation issues", symptoms: localResult.quickIssues });
            }

            await notifier.status(`Collected: ${evidence.map((e) => e.type).join(", ")}`);

            // Step 3: Backend diagnosis
            await notifier.status("Sending to backend for diagnosis...");
            const diagnosis = await client.diagnose(evidence, symptoms);

            if (diagnosis.diagnosis) {
              const d = diagnosis.diagnosis;
              console.log(`\nDiagnosis: ${d.name} (${d.icd_ai_code})`);
              console.log(`Severity: ${d.severity} | Confidence: ${(d.confidence * 100).toFixed(0)}%`);
              console.log(`\n${d.reasoning}`);
            } else {
              console.log("\nNo issues detected. Your agent appears healthy.");
              return;
            }

            // Step 4: Auto-execute treatment
            if (diagnosis.treatmentPlan.length > 0) {
              console.log(`\nStarting treatment (${diagnosis.treatmentPlan.length} steps)...\n`);

              const loopResult = await runTreatmentLoop({
                client,
                sessionId: diagnosis.sessionId,
                treatmentPlan: diagnosis.treatmentPlan,
                notifier,
                config: api.config,
              });

              console.log(`\nResult: ${loopResult.status} (${loopResult.stepsCompleted}/${loopResult.stepsTotal} steps)`);
              console.log(loopResult.message);

              if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
                console.log(`\nStep "${loopResult.pendingStep.id}" needs your input: ${loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description}`);
                console.log(`Run: openclaw claw-clinic treat ${diagnosis.sessionId} ${loopResult.pendingStep.id} --input "<your input>"`);
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Clinic error: ${message}`);
          }
        });

      cmd
        .command("treat")
        .description("Provide input for a paused treatment step and auto-continue")
        .argument("<sessionId>", "Session ID from the diagnosis")
        .argument("<stepId>", "Step ID to execute")
        .option("--input <value>", "User-provided input for the step")
        .action(async (...args: unknown[]) => {
          const sessionId = args[0] as string;
          const stepId = args[1] as string;
          const opts = (args[2] || {}) as Record<string, unknown>;
          const notifier = new ClinicNotifier(api, { mode: "cli" });

          try {
            await notifier.status(`Executing step ${stepId}...`);

            const response = await client.treat(sessionId, stepId, {
              success: true,
              data: opts.input ? { userInput: opts.input } : undefined,
            });

            console.log(`Status: ${response.status.toUpperCase()}`);
            console.log(response.message);

            // Auto-continue remaining steps
            if (response.status === "next" && response.nextStep) {
              await notifier.status("Continuing with remaining steps...");

              const loopResult = await runTreatmentLoop({
                client,
                sessionId,
                treatmentPlan: [response.nextStep],
                notifier,
                config: api.config,
              });

              console.log(`\nResult: ${loopResult.status}`);
              console.log(loopResult.message);

              if (loopResult.status === "paused_for_input" && loopResult.pendingStep) {
                console.log(`\nNext step needs input: ${loopResult.pendingStep.inputPrompt || loopResult.pendingStep.description}`);
                console.log(`Run: openclaw claw-clinic treat ${sessionId} ${loopResult.pendingStep.id} --input "<your input>"`);
              }
            } else if (response.status === "resolved") {
              console.log("\nIssue resolved. Your agent should now function normally.");
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Treatment error: ${message}`);
          }
        });

      cmd
        .command("health")
        .description("Quick backend connectivity check")
        .action(async () => {
          try {
            console.log("Checking backend connectivity...");
            const result = await client.healthCheck();
            console.log(`Backend: OK (version ${result.version})`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Backend unreachable: ${message}`);
          }
        });
    },
    { commands: ["claw-clinic"] },
  );
}
