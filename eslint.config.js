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
                // SillyTavern globals
                jQuery: "readonly",
                $: "readonly",
                toastr: "readonly",
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-undef": "error",
        }
    },
    {
        ignores: ["node_modules/**", "types/**"]
    }
];
