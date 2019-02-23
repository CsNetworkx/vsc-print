import * as vscode from 'vscode';
import * as hljs from "highlight.js";
import { readFileSync, writeFileSync } from 'fs';
import * as http from "http";
import * as child_process from "child_process";

export function activate(context: vscode.ExtensionContext) {
	printConfig = vscode.workspace.getConfiguration("print", null);
	let disposable = vscode.commands.registerCommand('extension.print', cmdArgs => {
		commandArgs = cmdArgs;
		startWebserver();
		child_process.exec(`${printConfig.browserPath || browserLaunchMap[process.platform]} http://localhost:${printConfig.port}/`);
	});
	context.subscriptions.push(disposable);
}

var commandArgs: any;
var printConfig: vscode.WorkspaceConfiguration;
var fileName: string;

const browserLaunchMap: any = {
	darwin: "open",
	linux: "xdg-open",
	win32: "start"
};

const paperWidthMap: any = {
	A3: "297mm", A3L: "420mm",
	A4: "210mm", A4L: "297mm",
	Letter: "215mm", LetterL: "279mm"
};

function getFileText(fname: string): string {
	var text = readFileSync(fname).toString();
	//strip BOM when present
	return text.indexOf('\uFEFF') === 0 ? text.substring(1, text.length) : text;
}

function getSourceCode(): string {
	try {
		let fileText = getFileText(commandArgs.fsPath);
		fileName = commandArgs.fsPath;
		return fileText;
	} catch (error) {
		if (vscode.window.activeTextEditor) {
			fileName = vscode.window.activeTextEditor.document.fileName;
			return vscode.window.activeTextEditor.document.getText();
		} else {
			throw new Error("Cannot access the specified file and there is no active editor");
		}
	}
}

const lineNumberCss = `
/* Line numbers */

table {
	border: none;
	border-collapse: collapse;
}
.line-number {
	border-right: thin solid silver;
	padding-right: 0.3em;
	text-align: right;
	vertical-align: top;
}
.line-text {
	margin-left: 0.7em;
  padding-bottom: {lineSpacing}em;
	white-space: pre-wrap;
}
`;

function getRenderedSourceCode(): string {
	let x = vscode.extensions.getExtension("pdconsec.print");
	if (!x) { throw new Error("Cannot resolve extension. Has the name changed? It is defined by the publisher and the extension name defined in package.json"); }
	let stylePath = `${x.extensionPath}/node_modules/highlight.js/styles`;
	let defaultCss = getFileText(`${stylePath}/default.css`);
	let swatchCss = getFileText(`${stylePath}/kimbie.light.css`);
	let renderedCode = hljs.highlightAuto(getSourceCode()).value;
	let pageCss = `\n@page {
		size: ${paperWidthMap[printConfig.paperSize]};
		margin: ${printConfig.margin}mm;
	}
	.hljs {
		max-width:100%;
	}\n`;
	// TODO RESPECT VSCODE NUMBERING SETTINGS FOR FILE TYPES
	var addLineNumbers = printConfig.lineNumbers === "on";
	if (addLineNumbers) {
		renderedCode = renderedCode
			.split("\n")
			.map((line, i) => `<tr><td class="line-number">${i}</td><td class="line-text">${line}</td></tr>`)
			.join("\n")
			.replace("\n</td>", "</td>")
			;
	}
	let bodyCss = `body{margin:0;padding:0;font-family: Consolas, monospace;font-size:${printConfig.fontSize};}\n`;
	let html = `<html><head><title>${fileName}</title><style>${pageCss}${bodyCss}${defaultCss}\r${swatchCss}\n${addLineNumbers ? lineNumberCss.replace("{lineSpacing}", printConfig.lineSpacing) : ""}</style></head><body onload="window.print();window.close();"><table class="hljs">${renderedCode}</table></body></html>`;
	try {
		writeFileSync("k:/temp/linenumbers.html", html);

	} catch (error) {
		// don't barf on other people's systems
	}
	return html;
}

var server: http.Server | undefined;
var port: number = 5050;

function startWebserver(): Promise<void> {
	return new Promise((resolve, reject) => {
		// clean up unexpected stragglers
		if (server !== undefined && printConfig.port !== port) {
			server.close(() => { });
			server = undefined;
		}
		if (server === undefined) {
			// prepare to service an http request
			server = http.createServer((request, response) => {
				if (request.url) {
					let html = getRenderedSourceCode();
					//response.setHeader("Content-Type", "text/html");
					response.end(html);
				}
			});
			// report exceptions
			server.on("error", (err: any) => {
				if (err) {
					switch (err.code) {
						case "EADDRINUSE":
							vscode.window.showInformationMessage(`PORT ${printConfig.port} OCCUPIED. CHANGE WEBSERVER CONFIG.`);
							break;
						case "EACCES":
							vscode.window.showInformationMessage("ACCESS DENIED ESTABLISHING WEBSERVER");
							break;
					}
					if (server) {
						server.close();
						server = undefined;
						port = 0;
					}
					reject();
				}
			});
			// clean up after one request
			server.on("request", (request: any, response: any) => {
				response.on("finish", () => {
					request.socket.destroy();
				});
			});
			server.listen(printConfig.port);
		}
		resolve();
	});
}

export function deactivate() { }