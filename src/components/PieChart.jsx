export default function PieChart({ data, size = 180 }) {
  // data: [{ id, name, icon, color, total }] where total is negative for spending
  const total = data.reduce((sum, d) => sum + Math.abs(d.total), 0);
  if (total === 0) return null;

  const radius = size / 2;
  const innerRadius = radius * 0.55;
  const cx = radius;
  const cy = radius;

  let cumulative = 0;
  const slices = data.map((d) => {
    const fraction = Math.abs(d.total) / total;
    const startAngle = cumulative * 2 * Math.PI;
    const endAngle = (cumulative + fraction) * 2 * Math.PI;
    cumulative += fraction;

    // Outer arc
    const x1 = cx + radius * Math.sin(startAngle);
    const y1 = cy - radius * Math.cos(startAngle);
    const x2 = cx + radius * Math.sin(endAngle);
    const y2 = cy - radius * Math.cos(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    // Inner arc
    const ix1 = cx + innerRadius * Math.sin(endAngle);
    const iy1 = cy - innerRadius * Math.cos(endAngle);
    const ix2 = cx + innerRadius * Math.sin(startAngle);
    const iy2 = cy - innerRadius * Math.cos(startAngle);

    const dPath = [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ');

    return { ...d, dPath, fraction };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {slices.map((s, i) => (
        <path key={i} d={s.dPath} fill={s.color || '#94a3b8'} stroke="var(--surface)" strokeWidth="2" />
      ))}
    </svg>
  );
}
