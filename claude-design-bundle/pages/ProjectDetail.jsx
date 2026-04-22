// Project detail page — progress + time-series + TODO + backlog with age

function ProjectDetail({ slug, onBack, onOpenReport }) {
  const { PROJECTS, BACKLOGS, TODOS, RESOLVED } = window.__DASH__;
  const project = PROJECTS.find(p => p.slug === slug);
  if (!project) return <div>Project not found</div>;
  const reports = project.reports;
  const latest = reports[reports.length - 1];
  const backlog = BACKLOGS[slug] || [];
  const todos = TODOS[slug] || [];
  const resolved = RESOLVED[slug] || [];

  const [backlogOpen, setBacklogOpen] = React.useState(false);

  return (
    <div style={{ fontFamily: 'var(--sans)', color: 'var(--fg-1)', background: 'var(--bg)', minHeight: '100%' }}>
      {/* Header */}
      <header style={{
        height: 52, display: 'flex', alignItems: 'center',
        padding: '0 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={onBack} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)',
          padding: '4px 8px', borderRadius: 3,
        }}>
          ← dashboard
        </button>
        <span style={{ color: 'var(--fg-3)', fontSize: 13, margin: '0 8px' }}>/</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>{project.name}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <RiskBadge level={latest.risk} size="md" />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
            {reports.length} reports
          </span>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
        {/* Floating back-to-dashboard pill */}
        <button onClick={onBack} style={{
          position: 'fixed', top: 92, right: 24,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-1)', border: '1px solid var(--border)',
          borderRadius: 999, padding: '9px 14px 9px 12px',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-1)',
          cursor: 'pointer', zIndex: 20,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)',
          transition: 'transform .15s, box-shadow .15s, border-color .15s',
        }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateX(-2px)';
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateX(0)';
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)';
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
          <span>대시보드</span>
        </button>
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
            <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, letterSpacing: '-0.02em', fontFamily: 'var(--mono)' }}>
              {project.name}
            </h1>
            <span style={{ fontSize: 13, color: 'var(--fg-3)' }}>· {project.displayName}</span>
          </div>
          <p style={{ margin: 0, color: 'var(--fg-2)', fontSize: 14, lineHeight: 1.6, maxWidth: 720 }}>
            {latest.summary}
          </p>
          <div style={{ display: 'flex', gap: 5, marginTop: 12, flexWrap: 'wrap' }}>
            {project.latestTags.map(t => <Tag key={t}>{t}</Tag>)}
          </div>
        </section>

        {/* Top row: Progress + risk strip summary */}
        <section style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24,
        }}>
          <MetricCard
            label="progress"
            value={`${latest.progress}%`}
            delta={latest.progress - reports[0].progress}
            deltaLabel="pts since first report"
            sub={<ProgressBar value={latest.progress} height={4} />}
          />
          <MetricCard
            label="doc score · avg"
            value={`${((latest.design + latest.technical + latest.spec) / 3).toFixed(1)}/10`}
            delta={((latest.design + latest.technical + latest.spec) / 3) - ((reports[0].design + reports[0].technical + reports[0].spec) / 3)}
            deltaLabel="vs first report"
            deltaFormat="decimal"
            sub={(
              <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                {['design', 'technical', 'spec'].map(k => (
                  <div key={k} style={{ flex: 1, height: 4, background: 'var(--bar-bg)', borderRadius: 1 }}>
                    <div style={{ height: '100%', width: `${(latest[k] / 10) * 100}%`, background: 'var(--accent)' }} />
                  </div>
                ))}
              </div>
            )}
          />
          <MetricCard
            label="risk trend"
            value={latest.risk.toUpperCase()}
            sub={(
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <RiskStrip reports={reports} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)' }}>
                  {reports.length} reports
                </span>
              </div>
            )}
          />
        </section>

        {/* Charts row */}
        <section style={{ marginBottom: 28 }}>
          <SectionHead title="시계열 추이" note="리포트별 스냅샷" />
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12,
          }}>
            <Panel>
              <PanelHead title="진행도 추이" note={`0 → ${latest.progress}% · ${reports.length} 스냅샷`} />
              <StepChart reports={reports} width={720} height={220} metric="progress" maxY={100} label="progress %" />
              <ReportAxisTicks reports={reports} onOpen={onOpenReport} />
            </Panel>
            <Panel>
              <PanelHead title="문서화 점수" note="design / technical / spec" />
              <MultiLineChart
                reports={reports}
                width={360}
                height={220}
                series={[
                  { key: 'design', label: 'design', color: 'var(--series-1)' },
                  { key: 'technical', label: 'technical', color: 'var(--series-2)' },
                  { key: 'spec', label: 'spec', color: 'var(--series-3)' },
                ]}
              />
            </Panel>
          </div>

          {/* Small multiples */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12,
          }}>
            <SmallMultiple label="progress" values={reports.map(r => r.progress)} latest={`${latest.progress}%`} accent="var(--series-1)" />
            <SmallMultiple label="design" values={reports.map(r => r.design)} latest={`${latest.design}/10`} accent="var(--series-1)" max={10} />
            <SmallMultiple label="technical" values={reports.map(r => r.technical)} latest={`${latest.technical}/10`} accent="var(--series-2)" max={10} />
            <SmallMultiple label="spec" values={reports.map(r => r.spec)} latest={`${latest.spec}/10`} accent="var(--series-3)" max={10} />
          </div>
        </section>

        {/* TODO + Backlog */}
        <section style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28,
        }}>
          <Panel>
            <PanelHead title="TODO" note={`최신 리포트 기준 · ${todos.length}건`} />
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {todos.map((t, i) => (
                <li key={i} style={{
                  display: 'grid', gridTemplateColumns: '28px 1fr', gap: 10,
                  padding: '10px 0',
                  borderBottom: i < todos.length - 1 ? '1px dashed var(--border-subtle)' : 'none',
                  alignItems: 'start',
                }}>
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)',
                    paddingTop: 2,
                  }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--fg-1)', textWrap: 'pretty' }}>
                    {t}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <PanelTitle>Backlog</PanelTitle>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                누적 {backlog.length} · 해결 {resolved.length}
              </span>
              <button
                onClick={() => setBacklogOpen(true)}
                style={{
                  marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11,
                  padding: '4px 8px', borderRadius: 3,
                  background: 'var(--bg-2)', border: '1px solid var(--border)',
                  color: 'var(--fg-2)', cursor: 'pointer',
                }}
              >
                history →
              </button>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {backlog.map((b, i) => (
                <li key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'start',
                  padding: '9px 0',
                  borderBottom: i < backlog.length - 1 ? '1px dashed var(--border-subtle)' : 'none',
                }}>
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--fg-1)', textWrap: 'pretty' }}>
                    {b.text}
                    <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>
                      first seen · {b.firstSeen}
                    </span>
                  </span>
                  <AgeBadge age={b.age} />
                </li>
              ))}
            </ul>
          </Panel>
        </section>

        {/* Timeline */}
        <section>
          <SectionHead title="리포트 타임라인" note={`${reports.length}개 스냅샷 · 최신순`} />
          <div style={{
            border: '1px solid var(--border)', borderRadius: 4,
            background: 'var(--bg-1)', overflow: 'hidden',
          }}>
            {[...reports].reverse().map((r, i, arr) => (
              <button key={r.date} onClick={() => onOpenReport(slug, r.date)} style={{
                display: 'grid',
                gridTemplateColumns: '180px 64px 100px 1fr 80px 24px',
                gap: 14, alignItems: 'center',
                padding: '14px 16px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                background: 'transparent', border: 'none', cursor: 'pointer',
                width: '100%', textAlign: 'left',
                fontFamily: 'var(--sans)', color: 'var(--fg-1)',
                transition: 'background .12s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-1)', whiteSpace: 'nowrap' }}>
                  {r.date}
                  {i === 0 && <span style={{ marginLeft: 6, padding: '1px 5px', background: 'var(--accent)', color: 'var(--bg)', fontSize: 9, borderRadius: 2, fontWeight: 600, whiteSpace: 'nowrap' }}>LATEST</span>}
                </span>
                <RiskBadge level={r.risk} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)' }}>
                  {r.commits} commits
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.summary}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-2)', textAlign: 'right' }}>
                  {r.progress}%
                </span>
                <span style={{ color: 'var(--fg-3)' }}>→</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {backlogOpen && (
        <BacklogHistoryDialog project={project} backlog={backlog} resolved={resolved} onClose={() => setBacklogOpen(false)} />
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function SectionHead({ title, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0, letterSpacing: '0.02em' }}>{title}</h2>
      {note && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>{note}</span>}
    </div>
  );
}

function Panel({ children }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 4,
      background: 'var(--bg-1)', padding: 16,
    }}>{children}</div>
  );
}

function PanelTitle({ children }) {
  return <h3 style={{ fontSize: 12, fontWeight: 600, margin: 0, letterSpacing: '0.02em' }}>{children}</h3>;
}

function PanelHead({ title, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
      <PanelTitle>{title}</PanelTitle>
      {note && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>{note}</span>}
    </div>
  );
}

function MetricCard({ label, value, delta, deltaLabel, deltaFormat, sub }) {
  const positive = typeof delta === 'number' && delta > 0;
  const zero = typeof delta === 'number' && delta === 0;
  const neg = typeof delta === 'number' && delta < 0;
  const deltaStr = deltaFormat === 'decimal' ? delta?.toFixed?.(1) : delta;
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 4,
      background: 'var(--bg-1)', padding: '14px 16px',
    }}>
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)',
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em' }}>
          {value}
        </span>
        {delta !== undefined && (
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11,
            color: positive ? 'var(--risk-low)' : neg ? 'var(--risk-high)' : 'var(--fg-3)',
          }}>
            {positive ? '+' : ''}{deltaStr}
            {deltaLabel && <span style={{ color: 'var(--fg-3)', marginLeft: 5 }}>{deltaLabel}</span>}
          </span>
        )}
      </div>
      <div style={{ marginTop: 10 }}>{sub}</div>
    </div>
  );
}

function SmallMultiple({ label, values, latest, accent, max = 100 }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 4,
      background: 'var(--bg-1)', padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-1)' }}>{latest}</span>
      </div>
      <Sparkline values={values} width={200} height={42} accent={accent} />
    </div>
  );
}

function ReportAxisTicks({ reports, onOpen }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      marginTop: 4, padding: '0 34px 0 34px',
    }}>
      {reports.map((r, i) => (
        <button key={r.date} onClick={() => onOpen && onOpen(reports.project, r.date)} style={{
          background: 'transparent', border: 'none',
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)',
          cursor: 'default', padding: 0,
        }}>
          {r.date.slice(8)}
        </button>
      ))}
    </div>
  );
}

// ─── Backlog history dialog ──────────────────────────────────────────

function BacklogHistoryDialog({ project, backlog, resolved, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 640, maxHeight: '80vh', overflow: 'auto',
        background: 'var(--bg-1)', border: '1px solid var(--border)',
        borderRadius: 6, padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Backlog History</h3>
          <span style={{ marginLeft: 10, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
            {project.name} · 누적 {backlog.length} · 해결 {resolved.length}
          </span>
          <button onClick={onClose} style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--fg-3)', cursor: 'pointer',
          }}>×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            carry-over · {backlog.length}
          </span>
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
            {[...backlog].sort((a, b) => b.age - a.age).map((b, i) => (
              <li key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
                padding: '8px 0', borderBottom: '1px dashed var(--border-subtle)',
              }}>
                <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  {b.text}
                  <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>
                    first · {b.firstSeen}
                  </span>
                </span>
                <AgeBadge age={b.age} />
              </li>
            ))}
          </ul>
        </div>

        {resolved.length > 0 && (
          <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--risk-low)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              ✓ resolved · {resolved.length}
            </span>
            <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
              {resolved.map((r, i) => (
                <li key={i} style={{
                  padding: '8px 0', borderBottom: '1px dashed var(--border-subtle)',
                  fontSize: 12.5, lineHeight: 1.55, color: 'var(--fg-2)',
                  display: 'flex', gap: 10, alignItems: 'center',
                }}>
                  <span style={{ color: 'var(--risk-low)' }}>✓</span>
                  <span style={{ flex: 1 }}>{r.text}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)' }}>{r.resolvedDate}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { ProjectDetail });
