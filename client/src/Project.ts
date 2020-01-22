/**
 * This class contains information about the users project as well as
 * providing basic project operations such as rename, save, etc.
 */
import { Context } from "./Context"

 export class Project{
  private _name: string
	private _filePath: string
	private _contexts: Context[]
	private _currentContext: Context
  constructor(name: string, filePath: string, contexts: Context[]){
    this._name = name
		this._filePath = filePath
		this._contexts = contexts
		this._currentContext = contexts[0]
  }

	get name(){
		return this._name
	}
  set name(name: string){
    this._name = name
    // change file dir?
	}

	get contexts(){
		return this._contexts
	}
	addContext(newContext: Context){
		if(newContext.filePath != null){
			this._contexts.push(newContext)
		}else{
			console.assert("context does not have file path")
		}
	}
	
	get currentContext(){
		return this._currentContext
	}

	set currentContext(newContext: Context){
		this._currentContext = newContext
	}

  set filePath(path: string){
    this._filePath = path
    // TODO: ASK should the project name and path be tied?
  }
}
