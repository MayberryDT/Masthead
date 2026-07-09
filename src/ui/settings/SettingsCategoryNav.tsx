export type SettingsCategory = "general" | "data" | "agent-access" | "advanced" | "danger";

type Props = {
  active: SettingsCategory;
  onChange: (category: SettingsCategory) => void;
};

const categories: Array<{ id: SettingsCategory; label: string }> = [
  { id: "general", label: "General" },
  { id: "data", label: "Data" },
  { id: "agent-access", label: "Agent access" },
  { id: "advanced", label: "Advanced" },
  { id: "danger", label: "Danger zone" }
];

export function SettingsCategoryNav({ active, onChange }: Props) {
  return (
    <nav className="settings-category-nav" aria-label="Settings categories">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={category.id === active ? "active" : ""}
          aria-current={category.id === active ? "page" : undefined}
          onClick={() => onChange(category.id)}
        >
          {category.label}
        </button>
      ))}
    </nav>
  );
}
