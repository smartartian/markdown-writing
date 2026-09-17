export namespace main {

	export class AppState {
	    documentDir: string;
	    openDocs: string[];

	    static createFrom(source: any = {}) {
	        return new AppState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.documentDir = source["documentDir"];
	        this.openDocs = source["openDocs"];
	    }
	}
	export class DBDocument {
	    id: number;
	    name: string;
	    size: number;
	    modTime: string;
	    createdAt: string;
	    updatedAt: string;
	    revision: number;

	    static createFrom(source: any = {}) {
	        return new DBDocument(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.revision = source["revision"];
	    }
	}
	export class Document {
	    name: string;
	    path: string;
	    size: number;
	    modTime: string;
	    isDir: boolean;
	    children?: Document[];

	    static createFrom(source: any = {}) {
	        return new Document(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.isDir = source["isDir"];
	        this.children = this.convertValues(source["children"], Document);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DocumentVersion {
	    id: number;
	    documentId: number;
	    revision: number;
	    name: string;
	    content: string;
	    size: number;
	    createdAt: string;

	    static createFrom(source: any = {}) {
	        return new DocumentVersion(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.documentId = source["documentId"];
	        this.revision = source["revision"];
	        this.name = source["name"];
	        this.content = source["content"];
	        this.size = source["size"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class FileDocument {
	    path: string;
	    content: string;
	    revision: number;
	    contentHash: string;
	    changed: boolean;

	    static createFrom(source: any = {}) {
	        return new FileDocument(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.content = source["content"];
	        this.revision = source["revision"];
	        this.contentHash = source["contentHash"];
	        this.changed = source["changed"];
	    }
	}
	export class FileVersion {
	    id: number;
	    path: string;
	    revision: number;
	    content: string;
	    contentHash: string;
	    size: number;
	    createdAt: string;

	    static createFrom(source: any = {}) {
	        return new FileVersion(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.revision = source["revision"];
	        this.content = source["content"];
	        this.contentHash = source["contentHash"];
	        this.size = source["size"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class RecycleItem {
	    id: number;
	    originalPath: string;
	    storedPath: string;
	    name: string;
	    deletedAt: string;

	    static createFrom(source: any = {}) {
	        return new RecycleItem(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.originalPath = source["originalPath"];
	        this.storedPath = source["storedPath"];
	        this.name = source["name"];
	        this.deletedAt = source["deletedAt"];
	    }
	}

}
