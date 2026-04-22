// Shared visual components for all three variations.
// Each variation scopes its styling with a wrapper class, so these
// components read tokens from CSS custom properties on the wrapper.

// ─── tiny primitives ────────────────────────────────────────────────

const riskColors = {
  low:    { dot: 'var(--risk-low)',    text: 'LOW',  label: 'low risk' },
  medium: { dot: 'var(--risk-med)',    text: 'MED',  label: 'medium risk' },
  high:   { dot: 'var(--risk-high)',   text: 'HIGH', label: 'high risk' },
};

function RiskBadge({ level, size = 'sm' }) {
  const r = riskColors[level] || riskColors.medium;
  const h = size === 'lg' ? 24 : size === 'md' ? 20 : 18;
  return (
    <span
      role="status"
      aria-label={r.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: h, padding: '0 8px', borderRadius: 3,
        background: 'var(--badge-bg)',
        border: '1px solid var(--border)',
        fontFamily: 'var(--mono)', fontSize: size === 'lg' ? 11 : 10,
        fontWeight: 600, letterSpacing: '0.08em',
        color: 'var(--fg-2)',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: r.dot, boxShadow: `0 0 0 2px ${r.dot}22`,
      }} />
      {r.text}
    </span>
  );
}

function Tag({ children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      height: 22, padding: '0 8px', borderRadius: 3,
      background: 'var(--tag-bg)',
      border: '1px solid var(--border-subtle)',
      color: 'var(--fg-2)',
      fontFamily: 'var(--mono)', fontSize: 11,
      whiteSpace: 'nowrap',
    }}>
      #{children}
    </span>
  );
}

function Kbd({ children }) {
  return (
    <kbd style={{
      fontFamily: 'var(--mono)', fontSize: 10,
      padding: '2px 5px', borderRadius: 3,
      background: 'var(--bg-2)', border: '1px solid var(--border)',
      color: 'var(--fg-2)',
    }}>{children}</kbd>
  );
}

// ─── sparkline ──────────────────────────────────────────────────────

function Sparkline({ values, width = 120, height = 32, accent, showDots = true, showArea = true, stroke = 1.5 }) {
  if (!values || values.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return [x, y];
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaD = `${d} L${pts[pts.length-1][0].toFixed(1)},${pad + h} L${pts[0][0].toFixed(1)},${pad + h} Z`;
  const ac = accent || 'var(--accent)';
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {showArea && <path d={areaD} fill={ac} fillOpacity={0.08} />}
      <path d={d} fill="none" stroke={ac} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
      {showDots && <circle cx={last[0]} cy={last[1]} r={2.5} fill={ac} />}
    </svg>
  );
}

// ─── step chart (progress over time) ────────────────────────────────

function StepChart({ reports, width = 560, height = 200, metric = 'progress', maxY = 100, accent, label }) {
  const pad = { t: 18, r: 18, b: 28, l: 34 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const values = reports.map(r => r[metric]);
  const xs = reports.map((_, i) => pad.l + (i / Math.max(1, reports.length - 1)) * w);
  const y = v => pad.t + h - (v / maxY) * h;
  const ac = accent || 'var(--accent)';

  // step path
  let d = '';
  reports.forEach((r, i) => {
    const px = xs[i];
    const py = y(r[metric]);
    if (i === 0) { d += `M${px},${py}`; }
    else {
      const prev = y(reports[i-1][metric]);
      d += ` L${px},${prev} L${px},${py}`;
    }
  });

  // gridlines
  const grid = [0, 25, 50, 75, 100].filter(g => g <= maxY || g === maxY);
  const gridY = (maxY === 10) ? [0, 2, 4, 6, 8, 10] : [0, 25, 50, 75, 100];

  return (
    <svg width={width} height={height} style={{ display: 'block', fontFamily: 'var(--mono)' }}>
      {/* grid */}
      {gridY.map((g, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(g)} y2={y(g)} stroke="var(--border-subtle)" strokeDasharray="2 3" />
          <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize={9} fill="var(--fg-3)">{g}</text>
        </g>
      ))}
      {/* step fill */}
      <path d={`${d} L${xs[xs.length-1]},${y(0)} L${xs[0]},${y(0)} Z`} fill={ac} fillOpacity={0.08} />
      {/* step line */}
      <path d={d} fill="none" stroke={ac} strokeWidth={1.5} strokeLinejoin="miter" strokeLinecap="butt" />
      {/* dots */}
      {reports.map((r, i) => (
        <circle key={i} cx={xs[i]} cy={y(r[metric])} r={2.5} fill="var(--bg)" stroke={ac} strokeWidth={1.5} />
      ))}
      {/* x labels: first and last */}
      <text x={xs[0]} y={height - 10} fontSize={9} fill="var(--fg-3)" textAnchor="start">
        {reports[0].date.slice(5)}
      </text>
      <text x={xs[xs.length-1]} y={height - 10} fontSize={9} fill="var(--fg-3)" textAnchor="end">
        {reports[reports.length-1].date.slice(5)}
      </text>
      {label && (
        <text x={width - pad.r} y={pad.t - 6} fontSize={10} fill="var(--fg-2)" textAnchor="end" fontWeight={600}>
          {label}
        </text>
      )}
    </svg>
  );
}

// ─── multi-series line chart (for doc_scores) ───────────────────────

function MultiLineChart({ reports, series, width = 560, height = 200, maxY = 10 }) {
  const pad = { t: 22, r: 12, b: 28, l: 30 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const xs = reports.map((_, i) => pad.l + (i / Math.max(1, reports.length - 1)) * w);
  const y = v => pad.t + h - (v / maxY) * h;
  const gridY = [0, 5, 10];

  return (
    <svg width={width} height={height} style={{ display: 'block', fontFamily: 'var(--mono)' }}>
      {gridY.map((g, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(g)} y2={y(g)} stroke="var(--border-subtle)" strokeDasharray="2 3" />
          <text x={pad.l - 6} y={y(g) + 3} textAnchor="end" fontSize={9} fill="var(--fg-3)">{g}</text>
        </g>
      ))}
      {series.map((s, si) => {
        const d = reports.map((r, i) => `${i ? 'L' : 'M'}${xs[i]},${y(r[s.key])}`).join(' ');
        return (
          <g key={s.key}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={1.5} strokeLinejoin="round" />
            {reports.map((r, i) => (
              <circle key={i} cx={xs[i]} cy={y(r[s.key])} r={2} fill="var(--bg)" stroke={s.color} strokeWidth={1.2} />
            ))}
          </g>
        );
      })}
      {/* legend */}
      <g transform={`translate(${pad.l}, 10)`}>
        {series.map((s, i) => (
          <g key={s.key} transform={`translate(${i * 72}, 0)`}>
            <line x1={0} x2={12} y1={4} y2={4} stroke={s.color} strokeWidth={1.5} />
            <text x={16} y={7} fontSize={10} fill="var(--fg-2)">{s.label}</text>
          </g>
        ))}
      </g>
      <text x={xs[0]} y={height - 10} fontSize={9} fill="var(--fg-3)" textAnchor="start">
        {reports[0].date.slice(5)}
      </text>
      <text x={xs[xs.length-1]} y={height - 10} fontSize={9} fill="var(--fg-3)" textAnchor="end">
        {reports[reports.length-1].date.slice(5)}
      </text>
    </svg>
  );
}

// ─── risk strip (dots per report, color-coded) ──────────────────────

function RiskStrip({ reports }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {reports.map((r, i) => (
        <div key={i} title={`${r.date} · ${r.risk}`} style={{
          width: 10, height: 10, borderRadius: 2,
          background: riskColors[r.risk].dot,
          opacity: i === reports.length - 1 ? 1 : 0.6,
          border: i === reports.length - 1 ? '1px solid var(--fg-1)' : 'none',
        }} />
      ))}
    </div>
  );
}

// ─── progress bar ───────────────────────────────────────────────────

function ProgressBar({ value, max = 100, height = 6, showLabel = false, accent }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <div style={{
        flex: 1, height, borderRadius: 2,
        background: 'var(--bar-bg)', overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: accent || 'var(--accent)',
          transition: 'width .6s cubic-bezier(.2,.8,.2,1)',
        }} />
      </div>
      {showLabel && (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)', minWidth: 34, textAlign: 'right' }}>
          {value}%
        </span>
      )}
    </div>
  );
}

// ─── age badge for backlog items ────────────────────────────────────

function AgeBadge({ age }) {
  const tone = age >= 5 ? 'stale' : age >= 3 ? 'aging' : 'fresh';
  const bg = { fresh: 'var(--age-fresh-bg)', aging: 'var(--age-aging-bg)', stale: 'var(--age-stale-bg)' }[tone];
  const fg = { fresh: 'var(--age-fresh-fg)', aging: 'var(--age-aging-fg)', stale: 'var(--age-stale-fg)' }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      height: 18, padding: '0 6px', borderRadius: 2,
      background: bg, color: fg,
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="1" />
        <path d="M4 2.5V4L5 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
      {age}R
    </span>
  );
}

// ─── doc score bars (3 scores as horizontal bars) ───────────────────

function DocScores({ scores }) {
  const items = [
    { key: 'design', label: 'Design' },
    { key: 'technical', label: 'Technical' },
    { key: 'spec', label: 'Spec' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(it => (
        <div key={it.key} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 32px', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{it.label}</span>
          <div style={{ height: 4, background: 'var(--bar-bg)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{
              width: `${(scores[it.key] / 10) * 100}%`, height: '100%',
              background: 'var(--accent)',
            }} />
          </div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)', textAlign: 'right' }}>
            {scores[it.key]}/10
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── export to global scope for sibling scripts ─────────────────────

Object.assign(window, {
  RiskBadge, Tag, Kbd, Sparkline, StepChart, MultiLineChart,
  RiskStrip, ProgressBar, AgeBadge, DocScores, riskColors,
});
