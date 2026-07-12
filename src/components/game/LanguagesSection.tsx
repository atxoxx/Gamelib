import { useMemo } from "react";
import type { Game } from "../../types/game";
import { IconCheck, IconGlobe, IconX } from "./icons";

/**
 * LanguagesSection
 *
 *  Right-sidebar card listing the languages the game supports and
 *  which features (interface / audio / subtitles) each one has.
 *  Builds a per-language map from the raw `languageSupports` list
 *  and renders a compact 4-column table: language + 3 ✓/— cells.
 *
 *  Empty `supportType` is silently skipped; languages with no
 *  records are never added to the map so the table never shows
 *  an empty "—" row.
 */

interface LanguagesSectionProps {
  game: Game;
}

interface LangFlags {
  interface: boolean;
  audio: boolean;
  subtitles: boolean;
}

export default function LanguagesSection({ game }: LanguagesSectionProps) {
  const languages = useMemo(() => {
    if (!game.languageSupports || game.languageSupports.length === 0) return null;
    const map: Record<string, LangFlags> = {};
    for (const ls of game.languageSupports) {
      if (!ls.language) continue;
      if (!map[ls.language]) {
        map[ls.language] = { interface: false, audio: false, subtitles: false };
      }
      const type = ls.supportType ? ls.supportType.toLowerCase() : "";
      if (type === "interface") map[ls.language].interface = true;
      else if (type === "audio") map[ls.language].audio = true;
      else if (type === "subtitles") map[ls.language].subtitles = true;
    }
    const list = Object.keys(map).sort();
    return list.length > 0 ? { list, map } : null;
  }, [game.languageSupports]);

  if (!languages) return null;

  return (
    <section className="game-section languages-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconGlobe size={16} />
        </span>
        Supported Languages
        <span className="game-section-title__count">{languages.list.length}</span>
      </h2>

      <div className="languages-table-wrap">
        <table className="languages-table">
          <thead>
            <tr>
              <th>Language</th>
              <th className="lang-th-center">Interface</th>
              <th className="lang-th-center">Audio</th>
              <th className="lang-th-center">Subtitles</th>
            </tr>
          </thead>
          <tbody>
            {languages.list.map((lang) => {
              const flags = languages.map[lang];
              return (
                <tr key={lang}>
                  <td className="lang-name">{lang}</td>
                  <td className="lang-cell-center">
                    {flags.interface ? (
                      <IconCheck size={14} style={{ color: "var(--color-success)" }} />
                    ) : (
                      <IconX size={14} style={{ color: "var(--color-text-muted)", opacity: 0.5 }} />
                    )}
                  </td>
                  <td className="lang-cell-center">
                    {flags.audio ? (
                      <IconCheck size={14} style={{ color: "var(--color-success)" }} />
                    ) : (
                      <IconX size={14} style={{ color: "var(--color-text-muted)", opacity: 0.5 }} />
                    )}
                  </td>
                  <td className="lang-cell-center">
                    {flags.subtitles ? (
                      <IconCheck size={14} style={{ color: "var(--color-success)" }} />
                    ) : (
                      <IconX size={14} style={{ color: "var(--color-text-muted)", opacity: 0.5 }} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
