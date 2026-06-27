import type { UsageByModelDto, UsageByProjectDto, UsageByRuntimeDto } from "../../app/daemonClient";
import { formatCompactUsage, formatUsageNumber } from "./formatUsage";
import { UsageHint } from "./UsageHint";

type Props =
  | { title: string; kind: "model"; rows: UsageByModelDto[] }
  | { title: string; kind: "project"; rows: UsageByProjectDto[] }
  | { title: string; kind: "runtime"; rows: UsageByRuntimeDto[] };

export function UsageBreakdownTable(props: Props) {
  return (
    <section className={`usage-table-card ${props.kind}`}>
      <h2>{props.title}</h2>
      <div className="usage-table-wrap">
        <table className="usage-table">
          {props.kind === "model" ? <ModelRows rows={props.rows} /> : null}
          {props.kind === "project" ? <ProjectRows rows={props.rows} /> : null}
          {props.kind === "runtime" ? <RuntimeRows rows={props.rows} /> : null}
        </table>
      </div>
    </section>
  );
}

function ModelRows({ rows }: { rows: UsageByModelDto[] }) {
  return (
    <>
      <thead>
        <tr>
          <th><UsageHint label="Model" tip="Model name reported by imported session metadata." /></th>
          <th><UsageHint label="Sessions" tip="Distinct sessions that used this model." /></th>
          <th><UsageHint label="Input" tip="Imported prompt/input tokens." /></th>
          <th><UsageHint label="Output" tip="Imported completion/output tokens." /></th>
          <th><UsageHint label="Total" tip="Combined imported input and output tokens." /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.provider ?? "unknown"}:${row.model}`}>
            <td>{row.model}</td>
            <td>{formatUsageNumber(row.sessions)}</td>
            <td>{formatCompactUsage(row.inputTokens)}</td>
            <td>{formatCompactUsage(row.outputTokens)}</td>
            <td>{formatCompactUsage(row.totalTokens)}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function ProjectRows({ rows }: { rows: UsageByProjectDto[] }) {
  return (
    <>
      <thead>
        <tr>
          <th><UsageHint label="Project" tip="Project label inferred or imported for the session." /></th>
          <th><UsageHint label="Sessions" tip="Sessions grouped under this project." /></th>
          <th><UsageHint label="Tokens" tip="Imported token total for this project." /></th>
          <th><UsageHint label="Tools" tip="Tool calls captured for this project." /></th>
          <th><UsageHint label="Files" tip="Observed file effects for this project." /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.project}>
            <td>{row.project}</td>
            <td>{formatUsageNumber(row.sessions)}</td>
            <td>{formatCompactUsage(row.totalTokens)}</td>
            <td>{formatUsageNumber(row.toolCalls)}</td>
            <td>{formatUsageNumber(row.fileEffects)}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function RuntimeRows({ rows }: { rows: UsageByRuntimeDto[] }) {
  return (
    <>
      <thead>
        <tr>
          <th><UsageHint label="Runtime" tip="Agent runtime that produced the sessions." /></th>
          <th><UsageHint label="Sessions" tip="Sessions grouped under this runtime." /></th>
          <th><UsageHint label="Tokens" tip="Imported token total for this runtime." /></th>
          <th><UsageHint label="Messages" tip="Message records captured for this runtime." /></th>
          <th><UsageHint label="Tools" tip="Tool calls captured for this runtime." /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.runtime}>
            <td>{row.runtime}</td>
            <td>{formatUsageNumber(row.sessions)}</td>
            <td>{formatCompactUsage(row.totalTokens)}</td>
            <td>{formatUsageNumber(row.messages)}</td>
            <td>{formatUsageNumber(row.toolCalls)}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}
