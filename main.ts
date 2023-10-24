import { App, Modal, moment, Notice, Plugin, PluginSettingTab, Setting, requestUrl, ButtonComponent } from 'obsidian';

interface ProjectData {
	project: Project,
	tasks: Tasks,
	columns: [Array<string>]
}

interface ChecklistItem {
	id: string,
	title: string,
	status: number,
	completedTime: number,
	isAllDay: boolean,
	sortOrder: number,
	startDate: string,
	timeZone: string
}

interface ChecklistItems extends Array<ChecklistItem> { }

interface Task {
	content: string,
	desc: string,
	dueDate: string,
	items: ChecklistItems
	id: string,
	isAllDay: boolean,
	priority: number,
	projectId: string,
	sortOrder: number,
	status: number,
	tags: Array<string>,
	timeZone: string,
	title: string
}

interface Tasks extends Array<Task> { }

interface Project {
	id: string,
	name: string,
	sortOrder: number
}

interface Projects extends Array<Project> { }

interface ElectronEvent {
	url: string
}

interface tckrSettings {
	dateFormat: string
	clientId: string;
	clientSecret: string;
	clientCode: string;
	apiToken: string;
	apiTokenExpiration: number;
	itemsPerPage: number;
}

const DEFAULT_SETTINGS: tckrSettings = {
	dateFormat: 'YYYY-MM-DD hh:mm:ss A',
	clientId: '',
	clientSecret: '',
	clientCode: '',
	apiToken: '',
	apiTokenExpiration: 0,
	itemsPerPage: 4
}

export default class tckr extends Plugin {
	settings: tckrSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		this.addRibbonIcon('check', 'tckr', async (evt: MouseEvent) => {
			// Called when the user clicks the icon.

			//v1
			if (this.isAPITokenValid()) {

				const projects: Projects = await this.getProjects()
				const projectId: string = projects[0].id
				const projectData: ProjectData = await this.getProjectData(projectId)

				const modal = new tckrModalManual(this.app)
				modal.itemsPerPage = this.settings.itemsPerPage
				modal.projects = projects
				modal.projectId = projectId
				modal.projectData = projectData
				modal.plugin = this

				modal.open()

			} else {
				new Notice('Invalid API Token: Refresh token in Settings')
			}


		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new tckrSettingTab(this.app, this));

	}

	async refreshToken(settings?: tckrSettingTab) {

		const electron = require('electron');
		const BrowserWindow = electron.remote.BrowserWindow;

		const childWindow = new BrowserWindow({
			width: 800,
			height: 600
		});

		// Load a remote URL
		childWindow.loadURL(`https://ticktick.com/oauth/authorize?client_id=${this.settings.clientId}&response_type=code&scope=tasks:read%20tasks:write&state=state&redirect_uri=http://localhost/`)
		childWindow.show()

		childWindow.webContents.on('will-redirect', async (event: ElectronEvent) => {
			if (event.url.contains('http://localhost/?code=')) {
				const code = event.url.substring(('http://localhost/?code=').length, event.url.indexOf('&state'))
				childWindow.close()

				this.settings.clientCode = code;
				this.saveSettings()

				await this.setAPIToken()

				if (typeof settings !== "undefined") {
					settings.display()
				}



			}

		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async setAPIToken() {
		const now: number = this.now();
		const id: string = this.settings.clientId;
		const secret: string = this.settings.clientSecret;
		const code: string = this.settings.clientCode;

		const body = {
			code: code,
			grant_type: 'authorization_code',
			scope: ['tasks: read', 'tasks: write'],
			redirect_uri: 'http://localhost/'

		}
		const headers = {
			'Content-Type': 'application/x-www-form-urlencoded',
			authorization: `Basic ${btoa(id + ':' + secret)}`
		}

		const response = await requestUrl({
			headers: headers,
			method: 'POST',
			url: `https://ticktick.com/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=http://localhost/`,
			body: JSON.stringify(body)
		})

		const data = await response.json

		this.settings.apiToken = data.access_token
		this.settings.apiTokenExpiration = now + (data.expires_in * 100)

		await this.saveSettings()

	}

	now(): number {
		return new Date().getTime();
	}

	isAPITokenExpired(): boolean {
		const now = this.now()
		const then = Number(this.settings.apiTokenExpiration)

		return ((then - now) > 0) ? false : true
	}

	isAPITokenValid(): boolean {
		return (this.settings.apiToken === '' || this.isAPITokenExpired()) ? false : true
	}

	async getProjects(): Promise<Projects> {
		const endpoint = 'https://api.ticktick.com/open/v1/project'

		const response = await requestUrl({
			method: 'GET',
			headers: { Authorization: `Bearer ${await this.getAPIToken()}` },
			url: endpoint
		})

		const data = await response.json

		return data
	}

	async getProjectData(projectId: string): Promise<ProjectData> {
		const endpoint: string = `https://api.ticktick.com/open/v1/project/${projectId}/data`

		const response = await requestUrl({
			method: 'GET',
			headers: { Authorization: `Bearer ${await this.getAPIToken()}` },
			url: endpoint
		})

		const data = await response.json

		return data
	}

	async getAPIToken() {

		if (!this.isAPITokenValid()) {

			return await this.refreshToken()
		}

		return this.settings.apiToken
	}

	async updateTask(id: string, projectId: string, status?: number) {
		const endpoint: string = `https://api.ticktick.com/open/v1/task/${id}`

		const body = {
			id: id,
			projectId: projectId,
			status: status
		}

		const headers = {
			Authorization: `Bearer ${await this.getAPIToken()}`,
			'Content-type': 'application/json'
		}

		const response = await requestUrl({
			contentType: 'application/json',
			method: 'POST',
			headers: headers,
			url: endpoint,
			body: JSON.stringify(body)
		})

		const data = await response.json

		return data
	}

	async getTask(projectId: string, id: string) {
		const endpoint: string = `https://api.ticktick.com/open/v1/project/${projectId}/task/${id}`

		const headers = {
			Authorization: `Bearer ${await this.getAPIToken()}`,
			'Content-type': 'application/json'
		}

		const response = await requestUrl({
			contentType: 'application/json',
			method: 'GET',
			headers: headers,
			url: endpoint
		})

		const data = await response.json
		return data
	}

	getPriority(priorityId: number): string {

		switch (priorityId) {
			case 1:
				return 'Low';
			case 3:
				return 'Medium'
			case 5:
				return 'High'
			default:
				return ''
		}
	}
}

class tckrModalManual extends Modal {
	plugin: tckr
	projectId: string
	projects: Projects
	projectData: ProjectData
	itemsPerPage: number
	pageNum: number = 1
	numOfPages: number

	constructor(app: App) {
		super(app)
	}

	async onOpen() {

		this.display();

	}

	getTask(num: number) {
		return this.projectData.tasks[num]
	}

	getTasks() {
		return this.projectData.tasks
	}

	getPageDisplay() {
		this.numOfPages = Math.ceil(this.getTasks().length / this.itemsPerPage)

		return `${this.numOfPages == 0 ? 0 : this.pageNum} / ${this.numOfPages}`
	}

	async display() {

		const { containerEl } = this
		this.contentEl.empty()

		const mainDiv = this.contentEl.createDiv({ cls: 'main-div' })
		const dropDown = mainDiv.createEl('select', { cls: 'projects' }, (el: HTMLSelectElement) => {
			el.onchange = async (ev: Event) => {
				this.projectId = this.projects[dropDown.selectedIndex].id
				this.pageNum = 1
				this.projectData = await this.plugin.getProjectData(this.projectId)
				this.display()

			}
		})
		const tasksDiv = mainDiv.createDiv({ cls: 'tasks' })

		//load dropdown
		this.loadProjects(this.projects, dropDown)


		const dataDiv = tasksDiv.createDiv({ cls: 'data-div' })
		const buttonDiv = tasksDiv.createDiv({ cls: 'button-div' })
		const buttonGroup = buttonDiv.createDiv({ cls: 'button-group' })
		const leftArrow = buttonGroup.createEl('button', { cls: 'button-left', text: '<-' })

		leftArrow.addEventListener('click', (ev: MouseEvent) => {
			if (this.pageNum > 1) {
				this.pageNum -= 1
				this.display()
			}
		})

		buttonGroup.createEl('button', { cls: 'no-hover', text: this.getPageDisplay() }, (el: HTMLButtonElement,) => {
			el.disabled = true
		})
		const rightArrow = buttonGroup.createEl('button', { cls: 'button-right', text: '->' })

		rightArrow.addEventListener('click', (ev: MouseEvent) => {
			if (this.pageNum < this.numOfPages) {
				this.pageNum += 1
				this.display()
			}
		})

		this.displayData(this.getPage(this.pageNum), dataDiv)
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	loadTasks(tasks: Tasks, div: HTMLDivElement) {
		div.innerHTML = ''
		tasks.forEach(task => {
			this.createTaskUI(div, task)
		})
	}

	loadProjects(projects: Projects, dropDown: HTMLSelectElement) {
		projects.forEach(project => {

			dropDown.createEl('option', { text: project.name })
		})

		dropDown.selectedIndex = projects.map(project => project.id).indexOf(this.projectId)
	}

	createCheckListItemDetails(task: Task, div: HTMLDivElement, item: ChecklistItem) {
		const itemDetailsDiv = div.createDiv({ cls: 'item-details task' })

		const checkBoxDiv = itemDetailsDiv.createDiv({ cls: 'checkbox-group' })
		const checkBox = checkBoxDiv.createEl('input', { type: 'checkbox', cls: 'task-checkbox no-hover' }, (el: HTMLInputElement) => {
			el.checked = item.status == 0 ? false : true
			el.disabled = true
			el.onchange = async (ev: Event) => {
				//:(
			}
		})

		const btnDiv = itemDetailsDiv.createDiv({ cls: 'collapsible-group' })
		const btn = btnDiv.createEl('button', { cls: 'collapsible', text: item.title })

		btn.addEventListener('click', () => {
			btn.classList.toggle('active')
			let content = contentDiv
			if (content.style.display === 'block') {
				content.style.display = 'none';
			}
			else {
				content.style.display = 'block'

			}
		})

		const contentDiv = btnDiv.createDiv({ cls: 'content' })
		const groupDiv = contentDiv.createDiv({ cls: 'content-group' })
		const dataDiv = groupDiv.createDiv({ cls: 'content-data' })
		dataDiv.createEl('p')

		if (typeof item.completedTime !== "undefined") {
			dataDiv.createEl('p', { text: `Completed time: ${this.getFormattedDate(moment(item.completedTime))}`, cls: 'content-text' })
			if (typeof item.timeZone !== "undefined") {
				dataDiv.createEl('p', { text: `Time Zone: ${item.timeZone}`, cls: 'content-text' })
			}
		}

		if (typeof item.isAllDay !== "undefined") {
			dataDiv.createEl('p', { text: `Is all day: ${item.isAllDay.toString()}`, cls: 'content-text' })
		}

		if (typeof item.startDate !== "undefined") {
			dataDiv.createEl('p', { text: `Start date: ${this.getFormattedDate(moment(item.startDate))}`, cls: 'content-text' })
		}
	}


	createCheckListUI(task: Task, div: HTMLDivElement, checkListItems: ChecklistItems) {
		const itemsGroupDiv = div.createDiv({ cls: 'items-group' })
		const btnItems = itemsGroupDiv.createEl('button', { text: `Checklist:`, cls: 'collapsible' })
		const itemsDiv = itemsGroupDiv.createDiv({ cls: 'items content' })

		btnItems.addEventListener('click', () => {
			btnItems.classList.toggle('active')
			let content = itemsDiv
			if (content.style.display === 'block') {
				content.style.display = 'none';
			}
			else {
				content.style.display = 'block'

			}
		})

		checkListItems.forEach((item: ChecklistItem) => {
			this.createCheckListItemDetails(task, itemsDiv, item)
		})


	}

	createTaskUI(div: HTMLDivElement, task: Task) {
		const taskDiv = div.createDiv({ cls: 'task' })

		const checkBoxDiv = taskDiv.createDiv({ cls: 'checkbox-group' })
		const checkBox = checkBoxDiv.createEl('input', { type: 'checkbox', cls: 'task-checkbox' }, (el: HTMLInputElement) => {
			el.checked = task.status == 1
			el.onchange = (ev: Event) => {
				task.status = el.checked ? 1 : 0
				this.plugin.updateTask(task.id, task.projectId, + el.checked)
			}
		})

		const btnDiv = taskDiv.createDiv({ cls: 'collapsible-group' })
		const btn = btnDiv.createEl('button', { cls: 'collapsible', text: task.title })

		const contentDiv = btnDiv.createDiv({ cls: 'content' })
		const groupDiv = contentDiv.createDiv({ cls: 'content-group' })
		const dataDiv = groupDiv.createDiv({ cls: 'content-data' })

		if (typeof task.content !== "undefined" && task.content !== '') {
			dataDiv.createEl('p', { text: `Content: ${task.content}`, cls: 'content-text' })
		}
		if (typeof task.desc !== "undefined" && task.desc !== '') {
			dataDiv.createEl('p', { text: `Desc: ${task.desc}`, cls: 'content-text' })
		}
		if (typeof task.dueDate !== "undefined") {
			dataDiv.createEl('p', { text: `Due date: ${this.getFormattedDate(moment(task.dueDate))}`, cls: 'content-text' })
			if (typeof task.timeZone !== "undefined") {
				dataDiv.createEl('p', { text: `Time Zone: ${task.timeZone}`, cls: 'content-text' })
			}
		}
		if (typeof task.isAllDay !== "undefined") {
			dataDiv.createEl('p', { text: `Is all day: ${task.isAllDay.toString()}`, cls: 'content-text' })
		}
		if (typeof task.priority !== "undefined" && task.priority > 0) {
			dataDiv.createEl('p', { text: `Priority: ${this.plugin.getPriority(task.priority)}`, cls: 'content-text' })
		}
		if (typeof task.tags !== "undefined") {
			if (task.tags.length > 0) {
				console.log(task.tags.length)
				console.log('here')
				console.log(task.tags)
				dataDiv.createEl('p', { text: `Has tags: ${task.tags}`, cls: 'content-text' })
			}
		}
		if (typeof task.items !== "undefined") {
			this.createCheckListUI(task, dataDiv, task.items)
		}

		btn.addEventListener('click', () => {
			btn.classList.toggle('active')
			let content = contentDiv
			if (content.style.display === 'block') {
				content.style.display = 'none';
			}
			else {
				content.style.display = 'block'

			}
		})
	}

	getFormattedDate(date: moment.Moment): string {

		return date.format(this.plugin.settings.dateFormat)
	}

	convertDateString(date: string) {
		return moment(date)

	}

	getTaskIndex(index: number): number {

		return index + ((this.pageNum - 1) * this.itemsPerPage)
	}

	getPage(page: number) {
		const min: number = (page - 1) * this.itemsPerPage
		const max: number = min + this.itemsPerPage
		let array = []

		for (let index = min; index < max && index < this.getTasks().length; index++) {
			const element = this.getTask(index);
			array.push(element)

		}

		return array

	}

	displayData(tasks: Tasks, div: HTMLDivElement) {

		tasks.forEach(task => {
			this.createTaskUI(div, task)
		})

	}
}
class tckrSettingTab extends PluginSettingTab {
	plugin: tckr;

	constructor(app: App, plugin: tckr) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Date format')
			.addText(text => text
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Client id')
			.addText(text => text
				.setValue(this.plugin.settings.clientId)
				.onChange(async (value) => {
					this.plugin.settings.clientId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Client secret')
			.addText(text => text
				.setValue(this.plugin.settings.clientSecret)
				.onChange(async (value) => {
					this.plugin.settings.clientSecret = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Client code')
			.addText(text => text
				.setDisabled(true)
				.setValue(this.plugin.settings.clientCode)
				.onChange(async (value) => {
					this.plugin.settings.clientCode = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API token')
			.addText(text => text
				.setDisabled(true)
				.setValue(this.plugin.settings.apiToken)
				.onChange(async (value) => {
					this.plugin.settings.apiToken = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API expiration')
			.addText(text => {
				text.setDisabled(true)
				if (this.plugin.settings.apiTokenExpiration > 0) {
					text.setValue(moment(this.plugin.settings.apiTokenExpiration).format('YYYY-MM-DD hh:mm:ss A'))
				}
			}
			);

		new Setting(containerEl)
			.addButton((cb) => {
				cb.setButtonText('Refresh token')

				cb.onClick(async (ev) => {
					if (this.plugin.settings.clientId == '' || this.plugin.settings.clientSecret == '') {
						new Notice('Client id and Client secret must be set')
					} else {
						await this.plugin.refreshToken(this)

					}

				})
			})

		new Setting(containerEl)
			.setName('Tasks per page')
			.addButton((cb: ButtonComponent) => {
				cb.setIcon('arrow-left')
				cb.onClick((evt: MouseEvent) => {
					if (this.plugin.settings.itemsPerPage > 1) {
						this.plugin.settings.itemsPerPage -= 1
						this.plugin.saveSettings()
						this.display()
					}
				})
			})
			.addButton((cb: ButtonComponent) => {
				cb.setIcon('arrow-right')
				cb.onClick((evt: MouseEvent) => {
					if (this.plugin.settings.itemsPerPage < 10) {
						this.plugin.settings.itemsPerPage += 1
						this.plugin.saveSettings()
						this.display()
					}
				})
			})
			.addButton((cb: ButtonComponent) => {
				cb.setDisabled(true)
				cb.setButtonText(this.plugin.settings.itemsPerPage.toString())
			})
	}
}
