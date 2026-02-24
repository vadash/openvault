import { TAG_LIST, TAG_ICONS } from '../src/ui/base/constants.js';

describe('TAG_LIST', () => {
    it('contains all 31 tags', () => {
        expect(TAG_LIST).toHaveLength(31);
        expect(TAG_LIST).toContain('EXPLICIT');
        expect(TAG_LIST).toContain('NONE');
    });
});

describe('TAG_ICONS', () => {
    it('has a default icon', () => {
        expect(TAG_ICONS.default).toBeDefined();
    });
    it('has icons for key tags', () => {
        expect(TAG_ICONS.COMBAT).toBeDefined();
        expect(TAG_ICONS.ROMANCE).toBeDefined();
    });
});
