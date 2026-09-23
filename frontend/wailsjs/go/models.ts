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

