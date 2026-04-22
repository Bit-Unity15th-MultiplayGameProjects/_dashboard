// Individual report page — a single snapshot

function ReportPage({ slug, date, onBack, onBackToProject }) {
  const { PROJECTS, BACKLOGS } = window.__DASH__;
  const project = PROJECTS.find(p => p.slug === slug);
  const report = project?.reports.find(r => r.date === date) || project?.reports[project.reports.length - 1];
  if (!project || !report) return <div>Report not found</div>;

  const reports = project.reports;
  const idx = reports.findIndex(r => r.date === report.date);
  const prev = idx > 0 ? reports[idx - 1] : null;
  const next = idx < reports.length - 1 ? reports[idx + 1] : null;

  const progressDelta = prev ? report.progress - prev.progress : report.progress;
  const backlog = BACKLOGS[slug] || [];

  return (
    <div style={{ fontFamily: 'var(--sans)', color: 'var(--fg-1)', background: 'var(--bg)', minHeight: '100%' }}>
      <header style={{
        height: 52, display: 'flex', alignItems: 'center',
        padding: '0 24px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)',
          padding: '4px 8px', borderRadius: 3,
        }}>
          ← dashboard
        </button>
        <span style={{ color: 'var(--fg-3)', fontSize: 13, margin: '0 4px' }}>/</span>
        <button onClick={() => onBackToProject()} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--fg-1)',
          padding: '4px 8px', borderRadius: 3,
        }}
          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
        >
          {project.name}
        </button>
        <span style={{ color: 'var(--fg-3)', fontSize: 13, margin: '0 4px' }}>/</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)' }}>{report.date}</span>
      </header>

      {/* Floating back-to-project pill — pinned to right margin, follows scroll */}
      <button onClick={() => onBackToProject()} style={{
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
        <span>프로젝트 개요</span>
      </button>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px 48px' }}>
        {/* Title */}
        <section style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            <span>report · {idx + 1} of {reports.length}</span>
            <span>·</span>
            <span>{report.commits} commits</span>
            <span>·</span>
            <span>{report.commitRange}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: '-0.02em', lineHeight: 1.3, textWrap: 'pretty' }}>
            {report.summary}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <RiskBadge level={report.risk} size="md" />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)' }}>
              진행도 {report.progress}%
              {prev && (
                <span style={{
                  marginLeft: 6,
                  color: progressDelta > 0 ? 'var(--risk-low)' : progressDelta < 0 ? 'var(--risk-high)' : 'var(--fg-3)',
                }}>
                  ({progressDelta > 0 ? '+' : ''}{progressDelta}pts)
                </span>
              )}
            </span>
          </div>
        </section>

        {/* Metric tiles */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
          <SnapshotTile label="progress" value={`${report.progress}%`} series={reports.map(r => r.progress)} current={idx} />
          <SnapshotTile label="design" value={`${report.design}/10`} series={reports.map(r => r.design)} current={idx} max={10} />
          <SnapshotTile label="technical" value={`${report.technical}/10`} series={reports.map(r => r.technical)} current={idx} max={10} />
          <SnapshotTile label="spec" value={`${report.spec}/10`} series={reports.map(r => r.spec)} current={idx} max={10} />
        </section>

        {/* Body markdown-style sections */}
        <article style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Sec title="주요 변경사항" body={`이번 리포트 기간 (${report.commitRange}) 동안 ${report.commits}건의 커밋이 누적되었습니다. ${report.summary}`} />
          <Sec title="코드 품질 리뷰" body={codeQualityNarrative(project, report, prev)} />
          <Sec title="진행도 평가" body={`이전 리포트 대비 ${progressDelta > 0 ? `+${progressDelta}pt 증가` : progressDelta < 0 ? `${progressDelta}pt 감소` : '변화 없음'}. 전체 진행도는 ${report.progress}%로, ${progressPhase(report.progress)} 단계에 해당합니다.`} />
          <Sec title="다음 권장사항" body="다음 리포트까지의 actionable 항목은 프로젝트 상세 페이지의 TODO 섹션을 참고하세요." />
          <Sec title="문서화 상태" body={(
            <DocScores scores={{ design: report.design, technical: report.technical, spec: report.spec }} />
          )} />
          <Sec title={`Backlog (${backlog.length})`} body={(
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {backlog.slice(0, 5).map((b, i) => (
                <li key={i} style={{
                  padding: '8px 0', borderBottom: '1px dashed var(--border-subtle)',
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'start',
                }}>
                  <span style={{ fontSize: 13, lineHeight: 1.55 }}>{b.text}</span>
                  <AgeBadge age={b.age} />
                </li>
              ))}
            </ul>
          )} />
        </article>

        {/* Full report history — replaces prev/next */}
        <section style={{
          marginTop: 36,
          marginLeft: -24, marginRight: -24,
          padding: '28px 24px 32px',
          background: 'var(--bg-2)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, letterSpacing: '0.02em' }}>
              리포트 타임라인
            </h2>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
              {reports.length}개 스냅샷 · 최신순
            </span>
          </div>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 4,
            background: 'var(--bg-1)', overflow: 'hidden',
          }}>
            {[...reports].reverse().map((r, i, arr) => {
              const isCurrent = r.date === report.date;
              return (
                <button key={r.date}
                  onClick={() => !isCurrent && onBackToProject(r.date)}
                  disabled={isCurrent}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '180px 64px 90px 1fr 70px 24px',
                    gap: 12, alignItems: 'center',
                    padding: '12px 14px',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                    background: isCurrent ? 'var(--bg-2)' : 'transparent',
                    border: 'none', borderRadius: 0,
                    cursor: isCurrent ? 'default' : 'pointer',
                    width: '100%', textAlign: 'left',
                    fontFamily: 'var(--sans)', color: 'var(--fg-1)',
                    transition: 'background .12s', opacity: isCurrent ? 1 : 1,
                  }}
                  onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--bg-2)'; }}
                  onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-1)', whiteSpace: 'nowrap' }}>
                    {r.date}
                    {isCurrent && <span style={{ marginLeft: 6, padding: '1px 5px', background: 'var(--accent)', color: 'var(--bg)', fontSize: 9, borderRadius: 2, fontWeight: 600, whiteSpace: 'nowrap' }}>CURRENT</span>}
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
                  <span style={{ color: 'var(--fg-3)' }}>{isCurrent ? '' : '→'}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function SnapshotTile({ label, value, series, current, max = 100 }) {
  const width = 180, height = 46;
  const pad = 3;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = series.map((v, i) => {
    const x = pad + (i / Math.max(1, series.length - 1)) * w;
    const y = pad + h - (v / max) * h;
    return [x, y];
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-1)', padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500 }}>{value}</span>
      </div>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <path d={d} fill="none" stroke="var(--fg-3)" strokeWidth={1.2} opacity={0.5} />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === current ? 3 : 1.5}
                  fill={i === current ? 'var(--accent)' : 'var(--fg-3)'}
                  stroke={i === current ? 'var(--bg-1)' : 'none'} strokeWidth={i === current ? 2 : 0} />
        ))}
      </svg>
    </div>
  );
}

function Sec({ title, body }) {
  return (
    <section>
      <h2 style={{
        fontSize: 16, fontWeight: 600, margin: '0 0 10px',
        paddingBottom: 8, borderBottom: '1px solid var(--border)',
      }}>{title}</h2>
      <div style={{ paddingLeft: 16 }}>
        {typeof body === 'string' ? (
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.75, color: 'var(--fg-1)', textWrap: 'pretty' }}>
            {body}
          </p>
        ) : body}
      </div>
    </section>
  );
}

function codeQualityNarrative(project, report, prev) {
  if (report.commits === 0) return '커밋이 없어 코드 품질 리뷰를 생략합니다.';
  const focus = project.latestTags.slice(0, 2).join(', ');
  return `주요 변경 영역: ${focus}. 기술 문서화 점수 ${report.technical}/10, 기획 문서화 ${report.design}/10. ${prev && report.technical > prev.technical ? '기술 설계서가 눈에 띄게 보강되었습니다.' : '기술 설계서의 추가 보강이 필요합니다.'}`;
}

function progressPhase(p) {
  if (p < 10) return '초기 스캐폴드';
  if (p < 30) return '기반 구축';
  if (p < 60) return '핵심 구현';
  if (p < 85) return '완성도 향상';
  return '출시 준비';
}

Object.assign(window, { ReportPage });
