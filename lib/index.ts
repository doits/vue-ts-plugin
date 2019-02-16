import * as ts_module from 'typescript/lib/tsserverlibrary';
import { parseComponent } from 'vue-template-compiler';
import path = require('path');

function isVue(filename: string): boolean {
  return path.extname(filename) === '.vue';
}

function isVueProject(path: string) {
  return path.endsWith('.vue.ts') && !path.includes('node_modules');
}

function parse(text: string) {
  const output = parseComponent(text, { pad: "space" });
  return output && output.script && output.script.content || 'export default {}';
}

function init({ typescript: ts } : {typescript: typeof ts_module}) {
  return { create, getExternalFiles };

  function create(info: ts.server.PluginCreateInfo) {
    changeSourceFiles(info);

    const compilerOptions = info.languageServiceHost.getCompilationSettings();
    info.languageServiceHost.resolveModuleNames = resolveModuleNames;
    const vueSys: ts.System = {
      ...ts.sys,
      fileExists(path: string) {
        if (isVueProject(path)) {
          return ts.sys.fileExists(path.slice(0, -3));
        }
        return ts.sys.fileExists(path);
      },
      readFile(path, encoding) {
        if (isVueProject(path)) {
          const fileText = ts.sys.readFile(path.slice(0, -3), encoding);
          return fileText ? parse(fileText) : fileText;
        } else {
          const fileText = ts.sys.readFile(path, encoding);
          return fileText;
        }
      }
    };

    function resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {
      // in the normal case, delegate to ts.resolveModuleName
      // in the relative-imported.vue case, manually build a resolved filename
      return moduleNames.map(name => {
        if (path.isAbsolute(name) || !isVue(name)) {
          return ts.resolveModuleName(name, containingFile, compilerOptions, ts.sys).resolvedModule;
        }
        const resolved = ts.resolveModuleName(name, containingFile, compilerOptions, vueSys).resolvedModule;
        if (!resolved) {
          return undefined as any;
        }
        if (!resolved.resolvedFileName.endsWith('.vue.ts')) {
          return resolved;
        }
        const resolvedFileName = resolved.resolvedFileName.slice(0, -3);
        const extension = ts.Extension.Ts;
        return { resolvedFileName, extension };
      });
    }

    return info.languageService;
  }

  function changeSourceFiles(info: ts.server.PluginCreateInfo) {
    const clssf = ts.createLanguageServiceSourceFile;
    const ulssf = ts.updateLanguageServiceSourceFile;
    function createLanguageServiceSourceFile(fileName: string, scriptSnapshot: ts.IScriptSnapshot, scriptTarget: ts.ScriptTarget, version: string, setNodeParents: boolean, scriptKind?: ts.ScriptKind, cheat?: string): ts.SourceFile {
      if (interested(fileName)) {
        const wrapped = scriptSnapshot;
        scriptSnapshot = {
          getChangeRange: old => wrapped.getChangeRange(old),
            getLength: () => wrapped.getLength(),
            getText: (start, end) => parse(wrapped.getText(0, wrapped!.getLength())).slice(start, end),
        };
      }
      var sourceFile = clssf(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind);
      if (interested(fileName)) {
        modifyVueSource(sourceFile);
      }
      return sourceFile;
    }

    function updateLanguageServiceSourceFile(sourceFile: ts.SourceFile, scriptSnapshot: ts.IScriptSnapshot, version: string, textChangeRange: ts.TextChangeRange, aggressiveChecks?: boolean, cheat?: string): ts.SourceFile {
      if (interested(sourceFile.fileName)) {
        const wrapped = scriptSnapshot;
        scriptSnapshot = {
          getChangeRange: old => wrapped.getChangeRange(old),
            getLength: () => wrapped.getLength(),
            getText: (start, end) => parse(wrapped.getText(0, wrapped.getLength())).slice(start, end),
        };
      }
      var sourceFile = ulssf(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
      if (interested(sourceFile.fileName)) {
        modifyVueSource(sourceFile);
      }
      return sourceFile;
    }
    ts.createLanguageServiceSourceFile = createLanguageServiceSourceFile;
    ts.updateLanguageServiceSourceFile = updateLanguageServiceSourceFile;
  }


  function interested(filename: string): boolean {
    return filename.slice(filename.lastIndexOf('.')) === ".vue";
  }

  function importInterested(filename: string): boolean {
    return interested(filename) && filename.slice(0, 2) === "./";
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

  function modifyVueSource(sourceFile: ts.SourceFile): void {
    // 1. add `import Vue from './vue'
    // 2. find the export default and wrap it in `new Vue(...)` if it exists and is an object literal
    //logger.info(sourceFile.getStart() + "-" + sourceFile.getEnd());
    const statements: ts_module.Statement[] = sourceFile.statements as any;
    const exportDefaultObject = find(statements, st => st.kind === ts.SyntaxKind.ExportAssignment &&
                                     (st as ts.ExportAssignment).expression.kind === ts.SyntaxKind.ObjectLiteralExpression);
    var b = <T extends ts.Node>(n: T) => ts.setTextRange(n, { pos: 0, end: 0 });
    if (exportDefaultObject) {
      //logger.info(exportDefaultObject.toString());
      const vueImport = b(ts.createImportDeclaration(undefined,
                                                     undefined,
      b(ts.createImportClause(b(ts.createIdentifier("Vue")), undefined)),
      b(ts.createLiteral("vue"))));
      statements.unshift(vueImport);
      const obj = (exportDefaultObject as ts.ExportAssignment).expression as ts.ObjectLiteralExpression;
      (exportDefaultObject as ts.ExportAssignment).expression = ts.setTextRange(ts.createNew(ts.setTextRange(ts.createIdentifier("Vue"), { pos: obj.pos, end: obj.pos + 1 }),
                                                                                             undefined,
      [obj]),
      obj);
      ts.setTextRange(((exportDefaultObject as ts.ExportAssignment).expression as ts.NewExpression).arguments!, obj);
    }
  }

  function getExternalFiles(project: ts_module.server.ConfiguredProject) {
    const result = project.getFileNames().filter(interested);
    project.projectService.openFiles.forEach((path, filename) => {
      if (interested(filename)) {
        result.push(ts.server.toNormalizedPath(filename));
      }
    });
    return result;
  }
}

export = init;
