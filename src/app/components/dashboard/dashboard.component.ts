import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Table } from 'primeng/table';
import { BehaviorSubject, combineLatest, map, Observable, of, shareReplay, switchMap, take, timer } from 'rxjs';

import { HashSuffixPipe } from '../../pipes/hash-suffix.pipe';
import { AppService } from '../../services/app.service';
import { ClientService } from '../../services/client.service';
import { AverageTimeToBlockPipe } from 'src/app/pipes/average-time-to-block.pipe';
import { LocalStorageService } from '../../services/local-storage.service';
import {
  chanceWithin, expectedSeconds, formatDuration, formatOneIn, formatPercent,
  SECONDS_PER_BLOCK, SECONDS_PER_DAY, SECONDS_PER_MONTH, SECONDS_PER_YEAR
} from '../../utils/block-odds';

const AUTO_REFRESH_MS = 60_000;
// Odds use the average of the last hour of 10-minute chart points; a single
// 10-minute reading swings too much to base odds on.
const ODDS_AVERAGE_POINTS = 6;

const CHAIN_NAMES: { [chain: string]: string } = {
  main: 'mainnet',
  test: 'testnet3',
  testnet4: 'testnet4',
  signet: 'signet',
  regtest: 'regtest'
};



@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements AfterViewInit {

  public address: string;

  public clientInfo$: Observable<any>;
  public chartData$: Observable<any>;

  public chartOptions: any;

  public networkInfo$: Observable<any>;
  private networkInfo:any;

  public odds$: Observable<any>;

  public autoRefresh: boolean;
  private autoRefresh$: BehaviorSubject<boolean>;

  @ViewChild('dataTable') dataTable!: Table;

  public expandedRows$: Observable<any>;



  constructor(
    private clientService: ClientService,
    private route: ActivatedRoute,
    private appService: AppService,
    private localStorageService: LocalStorageService
  ) {

    this.autoRefresh = this.localStorageService.getAutoRefresh();
    this.autoRefresh$ = new BehaviorSubject<boolean>(this.autoRefresh);
    // Emits once now, then every minute while auto refresh is on.
    const trigger$ = this.autoRefresh$.pipe(
      switchMap(on => on ? timer(0, AUTO_REFRESH_MS) : of(0))
    );
    const reload = <T>(load: () => Observable<T>) => trigger$.pipe(
      switchMap(() => load()),
      shareReplay({ refCount: true, bufferSize: 1 })
    );

    this.networkInfo$ = reload(() => this.appService.getNetworkInfo());

    this.address = this.route.snapshot.params['address'];
    this.clientInfo$ = reload(() => this.clientService.getClientInfo(this.address));

    // take(1): an auto refresh must not re-expand rows the user collapsed.
    this.expandedRows$ = this.clientInfo$.pipe(take(1), map((info: any) => {

      return info.workers.reduce((pre: any, cur: any) => { pre[cur.name] = true; return pre; }, {});

    }));

    const documentStyle = getComputedStyle(document.documentElement);
    const textColor = documentStyle.getPropertyValue('--text-color');
    const textColorSecondary = documentStyle.getPropertyValue('--text-color-secondary');
    const surfaceBorder = documentStyle.getPropertyValue('--surface-border');


    const clientChart$ = reload(() => this.clientService.getClientInfoChart(this.address));

    this.odds$ = combineLatest([clientChart$, this.clientInfo$, this.networkInfo$]).pipe(
      map(([chartData, clientInfo, networkInfo]) => this.calculateOdds(chartData, clientInfo, networkInfo))
    );

    this.chartData$ = combineLatest([clientChart$, this.networkInfo$]).pipe(
      map(([chartData, networkInfo]) => {

        this.networkInfo = networkInfo;
        const GROUP_SIZE = 12; //6 = 1 hour


        let hourlyData = [];

        for (let i = GROUP_SIZE; i < chartData.length; i += GROUP_SIZE) {
          let sum = 0;
          for (let j = GROUP_SIZE - 1; j >= 0; j--) {
            sum += parseInt(chartData[i - j].data);
          }
          sum = sum / GROUP_SIZE;
          hourlyData.push({ y: sum, x: chartData[i].label });
        }


        const data = chartData.map((d: any) => { return { y: d.data, x: d.label } });

        return {
          labels: chartData.map((d: any) => d.label),
          datasets: [
            {
              type: 'line',
              label: '2 Hour',
              data: hourlyData,
              fill: false,
              backgroundColor: documentStyle.getPropertyValue('--yellow-600'),
              borderColor: documentStyle.getPropertyValue('--yellow-600'),
              tension: .4,
              pointRadius: 1,
              borderWidth: 1
            },
            {
              type: 'line',
              label: '10 Minute',
              data: data,
              fill: false,
              backgroundColor: documentStyle.getPropertyValue('--primary-color'),
              borderColor: documentStyle.getPropertyValue('--primary-color'),
              tension: .4,
              pointRadius: 1,
              borderWidth: 1
            },

          ]
        }
      })
    );



    this.chartOptions = {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: textColor
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'hour', // Set the unit to 'minute'
          },
          ticks: {
            color: textColorSecondary
          },
          grid: {
            color: surfaceBorder,
            drawBorder: false,
            display: true
          }
        },
        y: {
          ticks: {
            color: textColorSecondary,
            callback: (value: number) => {
              return HashSuffixPipe.transform(value) + " - " + AverageTimeToBlockPipe.transform(value, this.networkInfo.difficulty);
            }
          },
          grid: {
            color: surfaceBorder,
            drawBorder: false
          }
        }
      }
    };

  }



  ngAfterViewInit() {

  }

  public autoRefreshChanged(on: boolean) {
    this.localStorageService.setAutoRefresh(on);
    this.autoRefresh$.next(on);
  }

  private calculateOdds(chartData: any[], clientInfo: any, networkInfo: any) {
    const recent = (chartData ?? []).slice(-ODDS_AVERAGE_POINTS).map((d: any) => Number(d.data)).filter(v => v > 0);
    const averaged = recent.length > 0;
    const hashRate = averaged
      ? recent.reduce((a: number, b: number) => a + b, 0) / recent.length
      : (clientInfo?.workers ?? []).reduce((a: number, w: any) => a + (Number(w.hashRate) || 0), 0);
    const difficulty = networkInfo.difficulty;
    const window = (label: string, seconds: number) => {
      const chance = chanceWithin(hashRate, difficulty, seconds);
      return { label, percent: formatPercent(chance), oneIn: formatOneIn(chance) };
    };
    return {
      chain: CHAIN_NAMES[networkInfo.chain] ?? networkInfo.chain,
      hashRate,
      hashRateSource: averaged ? `${recent.length * 10} min avg` : 'current',
      windows: [
        window('Per block', SECONDS_PER_BLOCK),
        window('Per day', SECONDS_PER_DAY),
        window('Per month', SECONDS_PER_MONTH),
        window('Per year', SECONDS_PER_YEAR)
      ],
      expected: formatDuration(expectedSeconds(hashRate, difficulty))
    };
  }

  public getDailyChance(name: string, workers: any[], difficulty: number) {
    const chance = chanceWithin(this.getTotalHashRate(name, workers), difficulty, SECONDS_PER_DAY);
    return `${formatPercent(chance)} (${formatOneIn(chance)})`;
  }

  public getBestDifficultyPercent(bestDifficulty: number, difficulty: number) {
    return formatPercent(difficulty > 0 ? bestDifficulty / difficulty : 0);
  }

  public getSessionCount(name: string, workers: any[]) {
    const workersByName = workers.filter(w => w.name == name);
    return workersByName.length;
  }

  public getTotalHashRate(name: string, workers: any[]) {
    const workersByName = workers.filter(w => w.name == name);
    const sum = workersByName.reduce((pre, cur, idx, arr) => {
      return pre += Math.floor(cur.hashRate);
    }, 0);
    return Math.floor(sum);
  }

  public getBestDifficulty(name: string, workers: any[]) {
    const workersByName = workers.filter(w => w.name == name);
    const best = workersByName.reduce((pre, cur, idx, arr) => {
      if (cur.bestDifficulty > pre) {
        return cur.bestDifficulty;
      }
      return pre;
    }, 0);

    return best;
  }

  public getTotalUptime(name: string, workers: any[]) {
    const now = new Date().getTime();
    const workersByName = workers.filter(w => w.name == name);
    const sum = workersByName.reduce((pre, cur, idx, arr) => {
      return pre += now - new Date(cur.startTime).getTime();
    }, 0);
    return new Date(now - sum);
  }
}
