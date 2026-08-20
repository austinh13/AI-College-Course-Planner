import type { CSSProperties } from "react";
import { MapPin } from "lucide-react";
import "./ScheduleCalendar.css";

const COURSE_COLORS = ["#5fe0b7", "#e87500", "#5fa8e0", "#e85f8a", "#e8c15f", "#a05fe0"];

const BASE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const UNIT_MINUTES = 15;

function formatClock(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function ScheduleCalendar({
  example,
  pinned = {},
  onTogglePin,
}: {
  example: Array<{ code: string; section: { sectionId: string; meetings: Array<{ day: string; start: number; end: number; kind?: string }> } }>;
  pinned?: Record<string, string>;
  onTogglePin?: (code: string, sectionId: string) => void;
}) {
  const colorByCode = new Map<string, string>();
  const sectionIdByCode = new Map<string, string>();
  let nextColor = 0;
  for (const { code, section } of example) {
    if (!colorByCode.has(code)) {
      colorByCode.set(code, COURSE_COLORS[nextColor % COURSE_COLORS.length]);
      nextColor++;
    }
    sectionIdByCode.set(code, section.sectionId);
  }

  const blocks = example.flatMap(({ code, section }) =>
    section.meetings.map((m) => ({ ...m, code, label: m.kind === "exam" ? `${code} Exam` : code }))
  );

  if (!blocks.length) {
    return <p className="text-sm text-[#8a8d8f]">Every picked section is TBA - there's no fixed weekly pattern to draw.</p>;
  }

  const days = [...BASE_DAYS, ...["Sat", "Sun"].filter((d) => blocks.some((b) => b.day === d))];

  const minStart = Math.min(...blocks.map((b) => b.start));
  const maxEnd = Math.max(...blocks.map((b) => b.end));
  const gridStart = Math.floor(minStart / 60) * 60;
  const gridEnd = Math.ceil(maxEnd / 60) * 60;
  const totalUnits = (gridEnd - gridStart) / UNIT_MINUTES;
  const hourMarks: number[] = [];
  for (let h = gridStart; h <= gridEnd; h += 60) hourMarks.push(h);

  const columns = `56px repeat(${days.length}, 1fr)`;
  const rowForMinute = (minute: number) => (minute - gridStart) / UNIT_MINUTES + 1;

  return (
    <div className="cal">
      <div className="cal__header" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((d) => (
          <div className="cal__day-label" key={d}>
            {d}
          </div>
        ))}
      </div>
      <div className="cal__body" style={{ gridTemplateColumns: columns, gridTemplateRows: `repeat(${totalUnits}, minmax(15px, 1fr))` }}>
        {hourMarks.map((h) => (
          <div
            key={`label-${h}`}
            className="cal__hour-label"
            style={{ gridColumn: "1", gridRow: `${rowForMinute(h)} / span 1` }}
          >
            {formatClock(h)}
          </div>
        ))}
        {hourMarks.map((h) => (
          <div
            key={`line-${h}`}
            className="cal__hour-line"
            style={{ gridColumn: `2 / -1`, gridRow: `${rowForMinute(h)} / span 1` }}
          />
        ))}
        {blocks.map((b, i) => {
          const eventStyle = {
            gridColumn: days.indexOf(b.day) + 2,
            gridRow: `${rowForMinute(b.start)} / ${rowForMinute(b.end)}`,
            "--event-color": colorByCode.get(b.code),
          } as CSSProperties;
          const sectionId = sectionIdByCode.get(b.code);
          const isPinned = sectionId != null && pinned[b.code] === sectionId;

          return (
            <div
              key={i}
              className={`cal__event${isPinned ? " cal__event--pinned" : ""}${onTogglePin ? " cal__event--pinnable" : ""}`}
              style={eventStyle}
              onClick={onTogglePin && sectionId != null ? () => onTogglePin(b.code, sectionId) : undefined}
              role={onTogglePin ? "button" : undefined}
              title={onTogglePin ? (isPinned ? `Unpin ${b.code}` : `Pin ${b.code}`) : undefined}
            >
              {onTogglePin && (
                <span className="cal__event-pin" aria-hidden="true">
                  <MapPin size={10} strokeWidth={2} />
                </span>
              )}
              <span className="cal__event-code">{b.label}</span>
              <span className="cal__event-time">
                {formatClock(b.start)}-{formatClock(b.end)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

