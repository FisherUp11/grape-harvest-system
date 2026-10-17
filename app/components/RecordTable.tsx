import type { ReactNode } from "react";

export default function RecordTable({
  headings,
  rows,
  empty = "暂无符合条件的记录。",
}: {
  headings: string[];
  rows: { id: string; cells: ReactNode[] }[];
  empty?: string;
}) {
  return (
    <div className="table-wrap record-table">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {row.cells.map((cell, i) => (
                <td key={headings[i]} data-label={headings[i]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={headings.length}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
