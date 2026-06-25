export type StatStripItem = {
  label: string;
  value: string;
};

type StatStripProps = {
  items: StatStripItem[];
  label?: string;
};

export function StatStrip({ items, label = "Summary" }: StatStripProps) {
  return (
    <dl className="stat-strip" aria-label={label}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
