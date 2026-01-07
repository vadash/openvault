import fs from 'fs';
import path from 'path';

const srcDir = './src/styles';
const outFile = './style.css';

// Order matters! Variables first, Utils last.
const files = [
    'variables.css',
    'layout.css',
    'components/cards.css',
    'components/dashboard.css',
    'components/forms.css',
    'components/navigation.css',
    'components/memory.css',
    'utils.css'
];

const bundle = files
    .map(f => {
        const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
        return `/* source: ${f} */\n${content}\n`;
    })
    .join('\n');

fs.writeFileSync(outFile, bundle);
console.log(`CSS Bundled: ${outFile}`);
