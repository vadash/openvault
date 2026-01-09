import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                // Browser globals
                window: "readonly",
                document: "readonly",
                console: "readonly",
                fetch: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                confirm: "readonly",
                prompt: "readonly",
                alert: "readonly",
                Worker: "readonly",
                URL: "readonly",
                navigator: "readonly",
                // SillyTavern globals
                jQuery: "readonly",
                $: "readonly",
                toastr: "readonly",
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
            "no-undef": "error",
        }
    },
    {
        ignores: ["node_modules/**", "types/**", "src/vendor/**"]
    },
    {
        files: ["**/worker.js"],
        languageOptions: {
            globals: {
                self: "readonly"
            }
        }
    },
    {
        files: ["scripts/**/*.js"],
        languageOptions: {
            globals: {
                process: "readonly"
            }
        }
    }
];
