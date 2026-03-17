// tests/ui/templates.test.js
import { describe, expect, it } from 'vitest';
import { graphStatsCard } from '../../src/ui/templates.js';

describe('graphStatsCard', () => {
  const mockStats = {
    entities: 142,
    relationships: 310,
    communities: 4,
    lastClustered: 12,
  };

  it('returns HTML string with entity count', () => {
    const html = graphStatsCard(mockStats);
    expect(html).toContain('142');
    expect(html).toContain('Entities Tracked');
  });

  it('returns HTML string with relationship count', () => {
    const html = graphStatsCard(mockStats);
    expect(html).toContain('310');
    expect(html).toContain('Relationships');
  });

  it('returns HTML string with community count', () => {
    const html = graphStatsCard(mockStats);
    expect(html).toContain('4');
    expect(html).toContain('Communities');
  });

  it('returns HTML string with last clustered message count', () => {
    const html = graphStatsCard(mockStats);
    expect(html).toContain('12 msgs ago');
  });

  it('handles zero values gracefully', () => {
    const html = graphStatsCard({ entities: 0, relationships: 0, communities: 0, lastClustered: 0 });
    expect(html).toContain('0');
    expect(html).toContain('Not yet clustered');
  });
});
