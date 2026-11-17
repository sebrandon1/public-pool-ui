import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, shareReplay } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {

  private PARTICLES = 'PARTICLES';
  private AUTO_REFRESH = 'AUTO_REFRESH';

  private _particles$: BehaviorSubject<boolean>;
  public particles$: Observable<boolean>;

  constructor() {
    this._particles$ = new BehaviorSubject<boolean>(this.getParticles());
    this.particles$ = this._particles$.asObservable().pipe(shareReplay({ refCount: true, bufferSize: 1 }));
  }

  private get(key: string): string | null {
    return localStorage.getItem(key);
  }

  private set(key: string, value: string) {
    localStorage.setItem(key, value);
  }

  private remove(key: string): void {
    localStorage.removeItem(key);
  }


  public getParticles(): boolean {
    const result = this.get(this.PARTICLES);
    return result == null || JSON.parse(result)?.particles === true;
  }

  public setParticles(particles: boolean) {
    this.set(this.PARTICLES, JSON.stringify({ particles }));
    this._particles$.next(particles);

  }

  public getAutoRefresh(): boolean {
    return this.get(this.AUTO_REFRESH) === 'true';
  }

  public setAutoRefresh(autoRefresh: boolean) {
    this.set(this.AUTO_REFRESH, String(autoRefresh));
  }


}
