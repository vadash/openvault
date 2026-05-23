#!/usr/bin/env node
/**
 * Check for missing await on async function calls.
 * Auto-discovers all exported async functions from source files.
 * This catches bugs that TypeScript/biome miss because JS lacks type inference.
 */

import fs from 'fs';
import path from 'path';

/**
 * Extract all exported async function names from a file.
 */
function extractAsyncFunctions(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const functions = [];

    // Pattern: export async function name(...)
    const exportAsyncPattern = /export\s+async\s+function\s+(\w+)\s*\(/g;
    let match;
    while ((match = exportAsyncPattern.exec(content)) !== null) {
        functions.push(match[1]);
    }

    // Pattern: async function name(...) (non-exported, still callable)
    const asyncPattern = /async\s+function\s+(\w+)\s*\(/g;
    while ((match = asyncPattern.exec(content)) !== null) {
        functions.push(match[1]);
    }

    return functions;
}

/**
 * Walk directory and collect all JS files.
 */
function walkDir(dir, files = []) {
    for (const f of fs.readdirSync(dir)) {
        const filePath = path.join(dir, f);
        if (fs.statSync(filePath).isDirectory()) {
            if (!f.includes('node_modules') && !f.includes('tests')) {
                walkDir(filePath, files);
            }
        } else if (f.endsWith('.js')) {
            files.push(filePath);
        }
    }
    return files;
}

/**
 * Discover all async functions from source files.
 */
function discoverAsyncFunctions() {
    const files = walkDir('src');
    const allFunctions = new Set();

    for (const f of files) {
        const funcs = extractAsyncFunctions(f);
        for (const fn of funcs) {
            allFunctions.add(fn);
        }
    }

    return allFunctions;
}

/**
 * Check a file for missing await issues.
 */
function checkFile(filePath, asyncFunctions) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const issues = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Skip imports, function declarations, comments, and lines that already have await
        if (
            line.includes('import ') ||
            line.includes('export async function') ||
            line.includes('async function') ||
            line.trim().startsWith('//') ||
            line.trim().startsWith('*') ||
            line.includes('await ')
        ) {
            continue;
        }

        for (const fn of asyncFunctions) {
            // Skip if this is the function definition itself
            if (line.includes(`function ${fn}`)) continue;

            // Pattern: assignment without await
            // Matches: const x = fn(...) or let x = fn(...) or var x = fn(...)
            const assignmentPattern = new RegExp(`(?:const|let|var)\\s+\\w+\\s*=\\s*${fn}\\s*\\(`);
            // Pattern: direct assignment (x = fn(...)) but not === comparison
            const directAssignPattern = new RegExp(`[^=]=[^=]\\s*${fn}\\s*\\(`);

            if (assignmentPattern.test(line)) {
                issues.push(`${filePath}:${lineNum}: Missing await on ${fn}()`);
            }

            // Check direct assignment more carefully - must be actual assignment, not comparison
            if (directAssignPattern.test(line) && !line.includes('===')) {
                // Verify it's actually an assignment by checking context
                const trimmed = line.trim();
                if (trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('var ')) {
                    // Already caught by assignmentPattern
                } else if (trimmed.match(/^\w+\s*=\s*$/) && lines[i + 1]?.includes(`${fn}(`)) {
                    // Multi-line assignment: x = \n fn()
                    issues.push(`${filePath}:${lineNum}-${lineNum + 1}: Missing await on ${fn}()`);
                }
            }

            // Pattern: immediate property/method access AFTER the full call
            // Use a different approach: check if line ENDS with property access after the call
            // This avoids issues with nested parentheses in arguments
            const _endsWithPropAccess = new RegExp(`${fn}\\s*\\([^)]*\\)[^;]*\\.\\w+\\s*[;(]`);

            // Better: look for the pattern where .property is accessed on the CALL result
            // by checking if there's a dot right after the closing paren of the function call
            const closingParenDotPattern = new RegExp(`${fn}\\s*\\(.*\\)\\s*\\.\\w+`);

            // Count parentheses to ensure we're matching the outer call's closing paren
            if (closingParenDotPattern.test(line)) {
                // Extract the part after the function call
                const callMatch = line.match(new RegExp(`${fn}\\s*\\(`));
                if (callMatch) {
                    const startIdx = callMatch.index + callMatch[0].length;
                    // Find the matching closing paren by counting
                    let depth = 1;
                    let endIdx = startIdx;
                    for (let j = startIdx; j < line.length; j++) {
                        if (line[j] === '(') depth++;
                        else if (line[j] === ')') depth--;
                        if (depth === 0) {
                            endIdx = j + 1;
                            break;
                        }
                    }
                    // Check if there's a dot immediately after the closing paren
                    if (endIdx < line.length && line[endIdx] === '.') {
                        // Get the method name being called
                        const afterCall = line.slice(endIdx + 1).trim();
                        const methodName = afterCall.match(/^(\w+)/)?.[1];
                        // Allow valid Promise chain methods
                        if (methodName && ['catch', 'then', 'finally'].includes(methodName)) {
                            continue; // Fire-and-forget pattern is valid
                        }
                        issues.push(`${filePath}:${lineNum}: Missing await on ${fn}() - property/method access`);
                    }
                }
            }

            // Pattern: array bracket access after call
            const bracketPattern = new RegExp(`${fn}\\s*\\([^)]*\\)\\s*\\[`);
            if (bracketPattern.test(line)) {
                issues.push(`${filePath}:${lineNum}: Missing await on ${fn}() - array access`);
            }

            // Pattern: passed to function that expects non-Promise (like .map, .filter, .push)
            const arrayMethodPattern = new RegExp(`\\.map\\([^)]*${fn}\\s*\\(`);
            const filterPattern = new RegExp(`\\.filter\\([^)]*${fn}\\s*\\(`);
            if (arrayMethodPattern.test(line) || filterPattern.test(line)) {
                issues.push(`${filePath}:${lineNum}: ${fn}() passed to array method without await`);
            }
        }
    }

    return issues;
}

// Main execution
const asyncFunctions = discoverAsyncFunctions();
console.log(`Discovered ${asyncFunctions.size} async functions to check`);

const files = walkDir('src');
let allIssues = [];

for (const f of files) {
    allIssues = allIssues.concat(checkFile(f, asyncFunctions));
}

if (allIssues.length > 0) {
    console.error('\n❌ Missing await issues found:\n');
    for (const issue of allIssues) {
        console.error(`  ${issue}`);
    }
    console.error(`\nTotal: ${allIssues.length} issues\n`);
    process.exit(1);
} else {
    console.log('✅ No missing await issues found in src/');
    process.exit(0);
}
