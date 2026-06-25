type Facet = {
  label: string;
  value: string;
  onRemove?: () => void;
};

type Props = {
  facets: Facet[];
};

export function LogbookFacets({ facets }: Props) {
  if (facets.length === 0) return null;
  return (
    <div className="logbook-facets" aria-label="Active Logbook filters">
      {facets.map((facet) => (
        <span key={`${facet.label}:${facet.value}`} className="logbook-facet">
          {facet.label}: {facet.value}
          {facet.onRemove ? (
            <button type="button" onClick={facet.onRemove} aria-label={`Remove ${facet.label} filter`}>
              x
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
