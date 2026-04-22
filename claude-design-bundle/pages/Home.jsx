// Home page — dense developer-tool aesthetic with data-dashboard leanings.
// Stat strip + filterable project table/grid with sparklines.

function Home({ onOpenProject, accent }) {
  const { PROJECTS, STATS } = window.__DASH__;
  const [view, setView] = React.useState('grid'); // 'grid' | 'table'
  const [filter, setFilter] = React.useState('all');

  const filtered = filter === 'all' ? PROJECTS : PROJECTS.filter(p => p.latestRisk === filter);

  return (
    <div style={{ fontFamily: 'var(--sans)', color: 'var(--fg-1)', background: 'var(--bg)', minHeight: '100%' }}>
      {/* Header */}
      <header style={{
        height: 52, display: 'flex', alignItems: 'center',
        padding: '0 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Bit-Unity15th
          </span>
          <span style={{ color: 'var(--fg-3)', fontSize: 13 }}>/</span>
          <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>dashboard</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          <span>Last build · {STATS.lastBuild}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--risk-low)', animation: 'dash-pulse 2s infinite' }} />
            synced
          </span>
        </div>
      </header>

      {/* Title + stat strip */}
      <section style={{ padding: '32px 24px 24px', maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>프로젝트 대시보드</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--fg-2)', fontSize: 13, lineHeight: 1.6 }}>
              Bit-Unity15th-MultiplayGameProjects organization 내 {STATS.projects}개 프로젝트의 코드리뷰·진행도 리포트.
            </p>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
            주간 스냅샷 · {STATS.reports} reports
          </div>
        </div>

        {/* stat strip */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
          border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden',
          background: 'var(--bg-1)',
        }}>
          <StatCell label="projects" value={STATS.projects} sub="active repos" />
          <StatCell label="reports" value={STATS.reports} sub="accumulated" />
          <StatCell label="risk · low" value={STATS.risks.low} dot="var(--risk-low)" />
          <StatCell label="risk · med" value={STATS.risks.medium} dot="var(--risk-med)" />
          <StatCell label="risk · high" value={STATS.risks.high} dot="var(--risk-high)" last />
        </div>
      </section>

      {/* Project list */}
      <section style={{ padding: '0 24px 48px', maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0, letterSpacing: '0.02em', color: 'var(--fg-1)' }}>
            프로젝트 <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--mono)', fontWeight: 400 }}>({filtered.length})</span>
          </h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <FilterTabs filter={filter} setFilter={setFilter} />
            <ViewToggle view={view} setView={setView} />
          </div>
        </div>

        {view === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {filtered.map(p => <ProjectCard key={p.slug} project={p} onOpen={() => onOpenProject(p.slug)} />)}
          </div>
        ) : (
          <ProjectTable projects={filtered} onOpen={onOpenProject} />
        )}
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)', padding: '18px 24px',
        fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)',
        display: 'flex', justifyContent: 'space-between', maxWidth: 1280, margin: '0 auto',
      }}>
        <span>Last build: {STATS.lastBuild}</span>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <div style={{
      width: 22, height: 22, borderRadius: 4,
      background: 'var(--accent)', position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="12" height="12" viewBox="0 0 12 12">
        <rect x="1" y="1" width="4" height="4" fill="var(--bg)" />
        <rect x="7" y="1" width="4" height="4" fill="var(--bg)" opacity="0.5" />
        <rect x="1" y="7" width="4" height="4" fill="var(--bg)" opacity="0.5" />
        <rect x="7" y="7" width="4" height="4" fill="var(--bg)" />
      </svg>
    </div>
  );
}

function StatCell({ label, value, sub, dot, last }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRight: last ? 'none' : '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
        color: 'var(--fg-3)', textTransform: 'uppercase',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />}
        {label}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em' }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{sub}</span>}
    </div>
  );
}

function FilterTabs({ filter, setFilter }) {
  const opts = [
    { k: 'all', label: 'all' },
    { k: 'low', label: 'low', dot: 'var(--risk-low)' },
    { k: 'medium', label: 'med', dot: 'var(--risk-med)' },
    { k: 'high', label: 'high', dot: 'var(--risk-high)' },
  ];
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
      {opts.map((o, i) => (
        <button
          key={o.k}
          onClick={() => setFilter(o.k)}
          style={{
            padding: '5px 10px', fontSize: 11, fontFamily: 'var(--mono)',
            border: 'none', cursor: 'pointer',
            background: filter === o.k ? 'var(--bg-2)' : 'var(--bg)',
            color: filter === o.k ? 'var(--fg-1)' : 'var(--fg-2)',
            borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          {o.dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: o.dot }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ViewToggle({ view, setView }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
      {['grid', 'table'].map((v, i) => (
        <button key={v} onClick={() => setView(v)} style={{
          padding: '5px 10px', fontSize: 11, fontFamily: 'var(--mono)',
          border: 'none', cursor: 'pointer',
          background: view === v ? 'var(--bg-2)' : 'var(--bg)',
          color: view === v ? 'var(--fg-1)' : 'var(--fg-2)',
          borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
        }}>{v}</button>
      ))}
    </div>
  );
}

// ─── Project card — includes sparkline + risk strip + progress ────

function ProjectCard({ project, onOpen }) {
  const progressSeries = project.reports.map(r => r.progress);
  const first = project.reports[0];
  const last = project.reports[project.reports.length - 1];
  const delta = last.progress - first.progress;

  return (
    <button onClick={onOpen} style={{
      textAlign: 'left', width: '100%',
      border: '1px solid var(--border)', borderRadius: 4,
      background: 'var(--bg-1)',
      padding: '16px 18px 14px', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 12,
      fontFamily: 'var(--sans)', color: 'var(--fg-1)',
      transition: 'border-color .12s, background .12s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {project.name}
            </span>
            <RiskBadge level={project.latestRisk} />
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55, textWrap: 'pretty' }}>
            {project.latestSummary}
          </p>
        </div>
      </div>

      {/* Progress row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              progress
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 500 }}>{last.progress}%</span>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 11,
              color: delta > 0 ? 'var(--risk-low)' : 'var(--fg-3)',
            }}>
              {delta > 0 ? `+${delta}` : delta === 0 ? '—' : delta} pts
            </span>
          </div>
          <ProgressBar value={last.progress} />
        </div>
        <Sparkline values={progressSeries} width={110} height={34} />
      </div>

      {/* Risk strip + tags */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            risk · {project.reports.length}R
          </span>
          <RiskStrip reports={project.reports} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {project.latestTags.slice(0, 3).map(t => <Tag key={t}>{t}</Tag>)}
        </div>
      </div>
    </button>
  );
}

// ─── Project table (denser view) ─────────────────────────────────────

function ProjectTable({ projects, onOpen }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-1)' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '220px 60px 80px 1fr 120px 100px 24px',
        padding: '9px 14px', background: 'var(--bg-2)',
        borderBottom: '1px solid var(--border)',
        fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--fg-3)', gap: 12, alignItems: 'center',
      }}>
        <span>project</span>
        <span>risk</span>
        <span style={{ textAlign: 'right' }}>prog</span>
        <span>trend</span>
        <span>tags</span>
        <span style={{ textAlign: 'right' }}>reports</span>
        <span />
      </div>
      {projects.map((p, i) => {
        const last = p.reports[p.reports.length - 1];
        return (
          <button key={p.slug} onClick={() => onOpen(p.slug)} style={{
            display: 'grid', gridTemplateColumns: '220px 60px 80px 1fr 120px 100px 24px',
            padding: '12px 14px', gap: 12, alignItems: 'center',
            borderBottom: i < projects.length - 1 ? '1px solid var(--border)' : 'none',
            background: 'transparent', border: 'none', borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
            cursor: 'pointer', width: '100%', textAlign: 'left',
            fontFamily: 'var(--sans)', color: 'var(--fg-1)',
            transition: 'background .12s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>{p.name}</span>
              <span style={{ fontSize: 11, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.latestSummary}
              </span>
            </div>
            <RiskBadge level={p.latestRisk} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'right' }}>{last.progress}%</span>
            <Sparkline values={p.reports.map(r => r.progress)} width={160} height={28} />
            <div style={{ display: 'flex', gap: 4, overflow: 'hidden' }}>
              {p.latestTags.slice(0, 2).map(t => <Tag key={t}>{t}</Tag>)}
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)', textAlign: 'right' }}>
              {p.reports.length}
            </span>
            <span style={{ color: 'var(--fg-3)' }}>→</span>
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { Home, Logo });
