import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ToastrService } from 'ngx-toastr';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ProteinViewerComponentService {
  public baseUrl = 'http://localhost:5000';
  private jobId: string | null = null;

  constructor(
    private http: HttpClient,
    private toastr: ToastrService
  ) {}

  /** (POST) Run backend script */
  postData(form: any, pdbFile?: File | null): Observable<any> {
    const formData = new FormData();
    formData.append('protein_chains', form.protein_chains);
    formData.append('partner_chains', form.partner_chains);
    formData.append('mutations', form.mutations);
    formData.append('detect_interface', String(form.detect_interface));

    if (pdbFile) formData.append('pdb_file', pdbFile);

    return this.http.post<{ status: string; job_id?: string }>(
      `${this.baseUrl}/run-script`,
      formData
    ).pipe(
      tap((res) => {
        if (res.job_id) {
          this.jobId = res.job_id;
          localStorage.setItem('proteinJobId', res.job_id);
          this.toastr.success('Upload started successfully!');
        } else {
          this.toastr.info('Processing request...');
        }
      }),
      catchError((error) => this.handleError(error))
    );
  }

  /** (GET) List extracted result files */
  getResultList(jobId?: string): Observable<any> {
    const id = jobId || this.jobId || localStorage.getItem('proteinJobId');
    if (!id) {
      this.toastr.warning('No job ID found. Please upload a file first.');
      return throwError(() => new Error('Missing job ID'));
    }

    return this.http.get(`${this.baseUrl}/check-result/${id}`).pipe(
      tap(() => this.toastr.success('Fetched result file list')),
      catchError((error) => this.handleError(error))
    );
  }

  /** (GET) Retrieve specific file content */
  getFileContent(jobId: string, filename: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/get-file/${jobId}/${filename}`).pipe(
      tap(() => this.toastr.info(`Fetched ${filename}`)),
      catchError((error) => this.handleError(error))
    );
  }

  /** Common error handler */
  private handleError(error: HttpErrorResponse) {
    if (error.status === 400) this.toastr.warning('Please fill in all required fields');
    else if (error.status === 500) this.toastr.error('Server error (500)');
    else if (error.status === 202) this.toastr.info('Result still processing...');
    else this.toastr.error('Unexpected error occurred');
    return throwError(() => error);
  }
}