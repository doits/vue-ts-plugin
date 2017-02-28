import * as ts_module from "../node_modules/typescript/lib/tsserverlibrary";

function init(modules: {typescript: typeof ts_module}) {
    const ts = modules.typescript;

    function create(info: ts.server.PluginCreateInfo) {
        // TODO: Maybe hook the document registry?
        // or add methods to the language service host, onCreateSourceFile/onUpdateSourceFile and add them as before/after advice.
        // but first, just try directly replacing the methods on ts!! yay!
        // Or just try to allow replacement of createSourceFile
        // Get a list of things to remove from the completion list from the config object.
        // If nothing was specified, we'll just remove 'caller'
        const whatToRemove: string[] = info.config.remove || ['caller'];
        const logger = info.project.projectService.logger;

        // Diagnostic logging
        logger.info("This message will appear in your logfile if the plugin loaded correctly");

        // Set up decorator
        const proxy = Object.create(null) as ts.LanguageService;
        const oldLS = info.languageService;
        for (const k in oldLS) {
            (proxy as any)[k] = function () {
                return oldLS[k].apply(oldLS, arguments);
            }
        }

        const clssf = ts.createLanguageServiceSourceFile;
        function replacement(fileName: string, scriptSnapshot: ts.IScriptSnapshot, scriptTarget: ts.ScriptTarget, version: string, setNodeParents: boolean, scriptKind?: ts.ScriptKind, range?: ts.TextRange): ts.SourceFile {
            logger.info(`*** hooked createLanguageServiceSourceFile for ${fileName} *****`);
            range = interested(fileName) ? parse(fileName, scriptSnapshot.getText(0, scriptSnapshot.getLength()), logger) : range;
            var sourceFile = clssf(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind, range);
            if (interested(fileName)) {
                modifyVueSource(sourceFile, logger);
            }
            return sourceFile;
        }
        //(info.languageService as any).createLanguageServiceSourceFile = replacement;
        ts.createLanguageServiceSourceFile = replacement;
        //(proxy as any).createLanguageServiceSourceFile = replacement;

        return proxy;
    }

    function interested(filename: string): boolean {
        // if all we get is the content I could work with that too I guess
        return filename.slice(filename.lastIndexOf('.')) === ".vue";
    }

    const scriptStart = "<scr"+"ipt>";
    const scriptEnd = "</scr"+"ipt>";
    function parse(fileName: string, text: string, logger: ts_module.server.Logger) {
        logger.info(`**** interested: ${fileName} *****`);
        const pos = text.indexOf(scriptStart) === -1 ? -1 : text.indexOf(scriptStart) + (scriptStart).length;
        const end = text.indexOf(scriptEnd);
        logger.info(`***** found text in range (${pos},${end})`); //:${text.slice(0,10)}...${text.slice(text.length - 10)} => ${text.slice(pos, pos + 10)}...${text.slice(end - 10, end)}`);
        return pos > -1 && end > -1 ? { pos, end } : undefined;
    }

    /** Works like Array.prototype.find, returning `undefined` if no element satisfying the predicate is found. */
    function find<T>(array: T[], predicate: (element: T, index: number) => boolean): T | undefined {
        for (let i = 0; i < array.length; i++) {
            const value = array[i];
            if (predicate(value, i)) {
                return value;
            }
        }
        return undefined;
    }

    function modifyVueSource(sourceFile: ts.SourceFile, logger: ts_module.server.Logger): void {
        logger.info(`***** post: number of statements: ${sourceFile.statements.length}`);
        // 1. add `import Vue from './vue'
        // 2. find the export default and wrap it in `new Vue(...)` if it exists and is an object literal
        //logger.info(sourceFile.getStart() + "-" + sourceFile.getEnd());
        const exportDefaultObject = find(sourceFile.statements, st => st.kind === ts.SyntaxKind.ExportAssignment &&
                                         (st as ts.ExportAssignment).expression.kind === ts.SyntaxKind.ObjectLiteralExpression);
        var b = <T extends ts.Node>(n: T) => ts.setTextRange(n, { pos: 0, end: 0 });
        if (exportDefaultObject) {
            //logger.info(exportDefaultObject.toString());
            const vueImport = b(ts.createImportDeclaration(undefined,
                                                           undefined,
                                                           b(ts.createImportClause(undefined,
                                                                                   b(ts.createNamedImports([
                                                                                       b(ts.createImportSpecifier(
                                                                                           b(ts.createIdentifier("Vue")),
                                                                                           b(ts.createIdentifier("Vue"))))])))),
                                                           b(ts.createLiteral("./vue"))));
            sourceFile.statements.unshift(vueImport);
            const obj = (exportDefaultObject as ts.ExportAssignment).expression as ts.ObjectLiteralExpression;
            (exportDefaultObject as ts.ExportAssignment).expression = ts.setTextRange(ts.createNew(ts.setTextRange(ts.createIdentifier("Vue"), { pos: obj.pos, end: obj.pos + 1 }),
                                                                                                   undefined,
                                                                                                   [obj]),
                                                                                      obj);
            ts.setTextRange(((exportDefaultObject as ts.ExportAssignment).expression as ts.NewExpression).arguments, obj);
        }
    }

    return { create, interested };
}

export = init;
