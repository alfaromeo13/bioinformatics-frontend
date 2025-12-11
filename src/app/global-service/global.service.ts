import JSZip from 'jszip';
import * as NGL from 'ngl';
import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { Subject, firstValueFrom } from 'rxjs';
import { ProteinHttpService } from "./protein.service";
import { SpinnerComponentService } from "../spinner-component/spinner.component.service";

@Injectable({ providedIn: 'root' })
export class GlobalService {

    /** Whether the user loaded a local ZIP instead of backend job results */
    zipMode = false;

    /** Shared NGL Stage instance used by the viewer */
    stage: any = null;

    /** Controls visibility of the viewer UI section */
    showViewer = false;

    /** List of filenames returned from backend or ZIP */
    resultFiles: string[] = [];

    /** Names of .dat mutation files (parsed keys) */
    datMutations: string[] = [];

    /** Loaded ZIP archive when ZIP mode is active */
    zipData: JSZip | null = null;

    /** Chain identifiers found in loaded PDB structures */
    availableChains: string[] = [];

    /** Tracks which PDB is currently displayed */
    currentlyShownPdb: string | null = null;

    /**
     * Parsed DAT results stored by filename.
     * Each entry contains residue, mutant and energy values.
     */
    parsedByFile: Record<string, {
        file: string;
        entries: { residue: string; mutant: string; energy: number }[];
    }> = {};

    /** Default viewer representation settings */
    viewerSettings = {
        representation: 'cartoon',
        color: 'chainname',
        focusChain: ''
    };

    /** Emits when heatmap should be (re)rendered */
    showHeatmap$ = new Subject<void>();

    /** Emits when camera auto-zoom animation should run */
    animateZoom$ = new Subject<void>();

    /** Emits when viewer should scroll into view */
    scrollRequest$ = new Subject<void>();


    constructor(
        private toastr: ToastrService,
        private loader: SpinnerComponentService,
        private proteinService: ProteinHttpService,
    ) { }

    /**
     * Loads a results ZIP archive selected by the user.
     * Enables offline preview mode. Populates result files, parses PDB + DAT files
     * and signals viewer/heatmap components to update.
     */
    async loadExistingJob(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input?.files?.[0];

        if (!file || !file.name.endsWith('.zip')) {
            this.toastr.warning('Please select a valid results ZIP (.zip)');
            return;
        }

        this.loader.setLoading(true);

        try {
            // Read ZIP content
            const zip = await JSZip.loadAsync(file);
            const allFiles = Object.keys(zip.files);

            this.zipMode = true;
            this.zipData = zip;

            // Disable backend mode completely
            localStorage.removeItem("proteinJobId");

            this.resultFiles = allFiles;
            this.toastr.success('Preview loaded from ZIP');

            const pdbFiles = allFiles.filter(f => f.endsWith('.pdb'));
            const datFiles = allFiles.filter(f => f.endsWith('.dat'));

            this.showViewer = true;
            await new Promise(r => setTimeout(r));

            // Create or reset NGL stage
            if (!this.stage) {
                this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
                window.addEventListener("resize", () => this.stage.handleResize(), false);
            } else {
                this.stage.removeAllComponents();
            }

            // Load PDBs into viewer
            for (const pdb of pdbFiles) {
                const content = await zip.file(pdb)!.async("string");
                const blob = new Blob([content], { type: "text/plain" });
                const comp = await this.stage.loadFile(blob, { ext: "pdb" });

                this.normalizeChainNames(comp.structure);
                comp.addRepresentation("cartoon", { colorScheme: "chainname" });
            }

            this.stage.autoView();
            this.animateZoom$.next();
            this.availableChains = this.getAvailableChains();
            this.scrollRequest$.next();

            // Parse DAT mutation files
            if (datFiles.length) {
                for (const dat of datFiles) {
                    const content = await zip.file(dat)!.async("string");
                    const parsed = this.parseFullDat(content, dat);
                    const key = dat.replace(/\.dat$/i, "");
                    this.parsedByFile[key] = parsed;
                }

                this.datMutations = Object.keys(this.parsedByFile);
                this.showHeatmap$.next();
            }

        } catch (err) {
            console.error("ZIP load error:", err);
            this.toastr.error("Failed to load ZIP preview");
        } finally {
            this.loader.setLoading(false);
        }
    }

    /**
     * Ensures all atoms have a valid chainname by copying segid when missing.
     * Prevents colorScheme='chainname' from breaking for certain PDB files.
     */
    normalizeChainNames(structure: any): void {
        structure.eachAtom((a: any) => {
            if (!a.chainname && a.segid) {
                a.chainname = a.segid.trim();
            }
        });

        const found = new Set<string>();
        structure.eachChain((c: any) => found.add(c.chainname));
        console.log('Normalized chains:', Array.from(found));
    }

    /**
     * Parses a .dat mutational energy file into a structured list:
     * residue number, mutant code, and calculated energy values.
     */
    parseFullDat(content: string, filename: string) {
        const lines = content.split('\n')
            .map(l => l.trim())
            .filter(l =>
                l &&
                !l.startsWith('GENERATED') &&
                !l.startsWith('SMEHEC') &&
                !l.startsWith('JOINING')
            );

        const parsed: { residue: string; mutant: string; energy: number }[] = [];

        for (const line of lines) {
            const match = line.match(/([A-Z0-9_]+)\s+(-?\d+(?:\.\d+)?)/);
            if (match) {
                const id = match[1];
                const energy = parseFloat(match[2]);

                const residueMatch = id.match(/(\d+)/);
                const mutantMatch = id.match(/([A-Z])$/);

                const residue = residueMatch ? residueMatch[1] : 'UNK';
                const mutant = mutantMatch ? mutantMatch[1] : '?';

                parsed.push({ residue, mutant, energy });
            }
        }

        return { file: filename.replace('.dat', ''), entries: parsed };
    }

    /**
     * Collects all distinct chain names currently loaded in the NGL stage.
     */
    getAvailableChains(): string[] {
        if (!this.stage) return [];

        const names = new Set<string>();

        this.stage.compList.forEach((comp: any) => {
            comp.structure.eachChain((chainProxy: any) => {
                if (chainProxy.chainname?.trim()) {
                    names.add(chainProxy.chainname.trim());
                }
            });
        });

        return Array.from(names);
    }

    /**
     * Loads PDB files from backend (non-ZIP mode) and displays them in the viewer.
     * Applies default representation and triggers camera auto-zoom.
     */
    async loadAllPdbsFromBackend(jobId: string, pdbFiles: string[]): Promise<void> {
        this.showViewer = true;
        await new Promise(r => setTimeout(r));

        // Create or reset stage
        if (!this.stage) {
            this.stage = new NGL.Stage("viewport", { backgroundColor: "white" });
            window.addEventListener("resize", () => this.stage.handleResize(), false);
        } else {
            this.stage.removeAllComponents();
        }

        // Load each PDB file into viewer
        for (const filename of pdbFiles) {
            try {
                const text = await this.getFile(jobId, filename);
                const blob = new Blob([text], { type: "text/plain" });
                const comp = await this.stage.loadFile(blob, { ext: "pdb" });

                this.normalizeChainNames(comp.structure);

                comp.addRepresentation(this.viewerSettings.representation, {
                    colorScheme: this.viewerSettings.color
                });

            } catch (err) {
                console.error(err);
                this.toastr.error(`Failed to load ${filename}`);
            }
        }

        this.stage.autoView();
        this.animateZoom$.next();
        this.availableChains = this.getAvailableChains();

        setTimeout(() => {
            this.scrollRequest$.next();
        }, 300);

        this.loader.setLoading(false);
    }

    /**
     * Retrieves a file:  
     * - From ZIP (if zipMode is active)  
     * - From backend otherwise  
     */
    async getFile(jobId: string | null, filename: string): Promise<string> {
        if (this.zipMode && this.zipData) {
            const z = this.zipData.file(filename);
            if (!z) throw new Error(`ZIP missing file ${filename}`);
            return await z.async("string");
        }

        return await firstValueFrom(this.proteinService.getFileContent(jobId!, filename));
    }
}