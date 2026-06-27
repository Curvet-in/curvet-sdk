/**
 * Run a workflow and watch it progress node-by-node (pollable async run).
 *
 * Best for long workflows (video / audio / 3D nodes) — `runAndPoll` submits the
 * run, then polls to completion so you never depend on one long HTTP call.
 *
 * Run with:
 *   CURVET_APP_KEY=cvt_app_xxx npx tsx examples/pollable-workflow.ts <workflowId>
 */
import { Curvet, WorkflowRunFailedError, WorkflowRunTimeoutError } from "../src";

const workflowId = process.argv[2] || "YOUR_WORKFLOW_ID";

async function main() {
  const curvet = new Curvet({ appKey: process.env.CURVET_APP_KEY });

  console.log(`Running workflow ${workflowId} ...\n`);

  const run = await curvet.workflows.runAndPoll(
    workflowId,
    { inputs: { topic: "freelance marketplaces" } },
    {
      pollIntervalMs: 2000,
      pollTimeoutMs: 300_000,
      onProgress: (r) => {
        const node = r.currentNode?.label ?? "—";
        const done = r.completedNodeCount ?? 0;
        const total = r.totalNodes ?? "?";
        console.log(`[${r.status}] ${r.progress ?? 0}%  node: ${node}  (${done}/${total})`);
      },
    },
  );

  console.log("\n✅ Completed");
  console.log("result:", JSON.stringify(run.result, null, 2));
}

main().catch((err) => {
  if (err instanceof WorkflowRunFailedError) {
    console.error(`❌ Run ${err.runId} failed: ${err.message}`);
  } else if (err instanceof WorkflowRunTimeoutError) {
    console.error(`⏱️ Run ${err.runId} timed out (still processing — poll later with workflows.runs.retrieve).`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
