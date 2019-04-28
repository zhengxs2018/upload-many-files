/**
 * 启动上传
 */

const fsPromises = require('fs-extra');
const path = require('path');
const request = require('request');
const chalk = require('chalk');
const Spinner = require('cli-spinner').Spinner;

const log = require('./log');

const dataFolderPath = __dirname + '/../data/';
const configPath = dataFolderPath + 'config.json';
const jobsMainPath = dataFolderPath + 'jobs-main.json';

// 一个任务文件的任务容量
const capacity = 100;
const spinner = new Spinner('%s ...');

module.exports = {

    /**
     * 上传文件
     *
     * @param {Object} program 命令行参数对象
     */
    async pipe(program) {
        if (program.start) {
            // 读取配置文件
            let configContent = await fsPromises.readFile(configPath);
            const config = JSON.parse(configContent);
            if (config.isInited) {
                await this.initUploadJobs(config);
            }
            else {
                const text = '未完成初始化';
                console.log(chalk.red(text));
                log.trace(text);
            }
        }
    },
    
    /**
     * 初始化上传任务
     *
     * @param {Object} config 配置对象
     */
    async initUploadJobs(config) {
        // 是否有中断的任务
        let jobsMainContent = await fsPromises.readFile(jobsMainPath);
        const jobsMain = JSON.parse(jobsMainContent);

        // 准备任务
        // status: 0 未开始，1 上传中，2 已完成
        if (jobsMain.status === 0) {
            spinner.setSpinnerTitle('扫描到需要上传文件总数: 0');
            spinner.start();
            await this.initJobs(config.folderPath, jobsMain, config, true);
        }

        // 开始上传
        spinner.start();
        this.startUploadFiles(config, jobsMain);
    },

    /**
     * 初始化任务文件，方便断点续传和任务统计
     *
     * @param {string} folderPath 文件夹路径
     * @param {Object} jobsMain 任务主对象
     * @param {Object} config 配置对象
     * @param {boolean} isTopFolder 是否是需要扫描的顶层文件夹
     */
    async initJobs(folderPath, jobsMain, config, isTopFolder) {
        const files = await fsPromises.readdir(folderPath);

        for (let index = 0; index < files.length; index++) {
            let filename = files[index];
            const filedir = path.join(folderPath, filename);
            const stats = await fsPromises.stat(filedir);
            // 文件夹
            if (stats.isDirectory()) {
                await this.initJobs(filedir, jobsMain, config);
            }
            // 文件
            else {
                await this.pushJobItem(filedir, jobsMain, config);
            }
        }
        if (isTopFolder) {
            if (jobsMain.jobsTotal % capacity > 0) {
                const groupNum =  Number.parseInt(jobsMain.jobsTotal / capacity) + 1;
                await this.writeJobsFile(jobsMain, groupNum);
            }
            // 写主任务文件
            jobsMain.currentJobsList = [];
            jobsMain.status = 1;
            const content = JSON.stringify(jobsMain, null, 2);
            await fsPromises.writeFile(jobsMainPath, content, {
                encoding: 'utf-8'
            }).then(() => {
                spinner.stop(true);
                console.log(`共扫描到 ${chalk.green(jobsMain.jobsTotal)} 个文件需要上传`);
            }, error => {
                const text = '上传任务准备失败';
                console.log(chalk.red(text, error));
                log.trace(text);
            });
        }
    },

    /**
     * 压入一个任务到任务队列
     *
     * @param {string} filedir 文件路径
     * @param {Object} jobsMain 任务主对象
     * @param {Object} config 配置对象
     */
    async pushJobItem(filedir, jobsMain, config) {
        const extnames = config.extname.split(',');
        const extname = path.extname(filedir);

        if (extnames.includes(extname)) {
            jobsMain.currentJobsList.push({
                path: filedir,
                isUploaded: false
            });
            jobsMain.jobsTotal++;
            if (jobsMain.jobsTotal % capacity === 0) {
                // 写子任务文件
                const groupNum =  Number.parseInt(jobsMain.jobsTotal / capacity);
                await this.writeJobsFile(jobsMain, groupNum);
            }
            
            spinner.setSpinnerTitle('扫描到需要上传文件总数: ' + chalk.green(jobsMain.jobsTotal));
        }
    },

    /**
     * 子任务写入文件
     *
     * @param {Object} jobsMain 任务主对象
     * @param {number} groupIndex 任务组序号，从 1 开始
     */
    async writeJobsFile(jobsMain, groupIndex) {
        const content = JSON.stringify({
            isAllUploaded: false,
            jobs: jobsMain.currentJobsList
        }, null, 2);
        await fsPromises.writeFile(`${dataFolderPath}jobs-${groupIndex}.json`, content, {
            encoding: 'utf-8'
        }).then(() => {
            jobsMain.currentJobsList = [];
        }, error => {
            console.log(chalk.red('上传任务准备失败', error));
        });
    },

    /**
     * 开始上传文件
     *
     * @param {Object} config 配置对象
     * @param {Object} jobsMain 任务对象
     */
    async startUploadFiles(config, jobsMain) {
        const jobsTotal = jobsMain.jobsTotal;
        const jobsGroupTotal =  Number.parseInt(jobsTotal / capacity) + (jobsTotal % capacity > 0 ? 1 : 0);

        // 内存中驻留的最大上传进程数
        const maxJobs = 10;
        // let end = index + part < jobs.jobList.length ? index + part : jobs.jobList.length;
        // // 本批上传总量
        // let total = end - index;
        
        // while (index < end) {
        //     if (jobs.jobList[index].isUploaded === false) {
        //         postFile(index, end);
        //     }
        //     else {
        //         // checkEnd(index, end);
        //     }
        //     index++;
        // }

        /**
         * 
         * @param {number} index 上传的任务序号
         * @param {number} end 本批任务的结束序号
         */
        function postFile(index, end) {
            const path = jobs.jobList[index].path;
            let formData = {
                file: fs.createReadStream(path),
                // todo 开发可配置多余参数
                source: 'hz', // 来源 
                batch: 'hz-bq-8', // 批次 
                diseasesType: 'fundus' // 疾病类型、fundus眼底/其他数据类型/
            };
            log.trace(`开始上传 path: ${path}`);
            request.post({
                url: config.serverUrl,
                formData
            }, (error, res, body) => {
                if (!error && res.statusCode === 200) {
                    jobs.jobList[index].isUploaded = true;
                    jobs.uploadedTotal++;
                    spinner.setSpinnerTitle(`正在上传: ${jobs.uploadedTotal}/${jobs.jobList.length}`);
                    log.trace(`上传成功 path: ${path}`);
                    // checkEnd(index, end);
                }
                else {
                    log.trace(`上传失败 path: ${path}`);
                }
            });
        }
    }
};